import "server-only";
import { randomUUID } from "node:crypto";
import { paths } from "@the-manager/persistence";
import type { DriverId, ProjectId } from "@the-manager/shared";
import { enqueueProjectProposal } from "../../../lib/manager-requests";
import { repos } from "../../../lib/runtime";
import {
  getOrCreateSession,
  getSession,
  listStatuses,
  readRecentLines,
  writeInput,
} from "../../../lib/sessions";
import { destroyEphemeralProject } from "../../../lib/temp-projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Model Context Protocol (MCP) bridge for the Manager.
 *
 * Hand-rolled minimal JSON-RPC over HTTP — Claude Code's MCP client sends
 * `initialize` / `tools/list` / `tools/call` as JSON-RPC 2.0 messages over
 * POST, and we respond inline with JSON. We don't open server-initiated SSE
 * streams (no notifications yet), so GET is a 405.
 *
 * The bridge runs in-process: tool handlers call `repos` and `sessions.ts`
 * directly. The Manager's `.claude/settings.local.json` (auto-written by
 * `sessions.ts` on Manager spawn) points its MCP client at this endpoint.
 *
 * Tools exposed (v1):
 *   - list_projects: registered projects, their cwd + default driver.
 *   - get_project_status: liveness for one project's pty session.
 *   - send_to_project: write `text + \r` to a project's terminal.
 *   - read_project_terminal: tail of the project's recording buffer.
 *   - propose_project: ask the user to register a new project (the UI surfaces
 *     a dialog with the Manager's prefill; this call blocks until the user
 *     confirms or cancels).
 *   - destroy_temp_project: tear down an ephemeral project that the Manager
 *     created earlier; refuses non-ephemeral projects.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "the-manager", version: "0.1.0" };

const TOOLS = [
  {
    name: "list_projects",
    description:
      "List all projects The Manager knows about. Each entry has id, name, path, defaultDriver, and an auto-generated `description` (one or two sentences summarising what the project is — may be null if generation hasn't finished or failed). Use the id with the other tools.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_project_status",
    description:
      "Liveness for a project's claude session: { alive: boolean, lastActivityAt: ISO timestamp | null }. `alive: false` means no live pty exists for that project right now.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id from list_projects." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_to_project",
    description:
      "Write text to a project's interactive claude terminal as if the user had typed it. If the project's claude session is already running, Enter is appended automatically (the prompt is submitted). If the session has to be cold-spawned by this call, the text is typed but Enter is NOT pressed — the prompt sits in the user's input box for them to review and submit. Returns 'sent' (existing session, submitted) or 'spawned' (cold spawn, prompt typed but not submitted).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        text: {
          type: "string",
          description: "What to send. Trailing Enter is added automatically.",
        },
      },
      required: ["id", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "read_project_terminal",
    description:
      "Return the last N lines of pty output (default 100, max 5000) from a project's claude session. Use this to see what an agent has done recently before sending a follow-up prompt.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        lines: {
          type: "number",
          description: "How many trailing lines to return.",
          minimum: 1,
          maximum: 5000,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_project",
    description:
      "Ask the user to register a project. The UI opens the project-creation dialog prefilled with whatever fields you provide, plus a banner showing your `reason`. The user can edit anything (including the path via the folder picker) before confirming. This call BLOCKS for up to 5 minutes waiting for the user. Returns either `{ kind: 'confirmed', project: { id, name, path, defaultDriver, ephemeral } }` or `{ kind: 'cancelled' }`. If `ephemeral: true`, the project is auto-destroyed (explicit destroy_temp_project, on Manager restart, or 24h TTL) and the dialog's ephemeral checkbox is pre-checked. Use this for: (a) starting a brand-new project on disk, (b) adding an existing repo, and (c) creating a scratch project for a long task. Always include a clear `reason` so the user understands why you're asking.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Suggested project name. The user can edit before confirming.",
        },
        path: {
          type: "string",
          description:
            "Suggested absolute path. For ephemeral projects, omit this and the server will suggest one under ~/.the-manager/temp/<uuid>/. For non-ephemeral, the path must already exist on disk (you can suggest one anyway and the user picks the real folder).",
        },
        defaultDriver: {
          type: "string",
          enum: ["claude", "codex", "gemini"],
          description: "Suggested driver; defaults to 'claude'.",
        },
        ephemeral: {
          type: "boolean",
          description:
            "True for scratch / temp projects that should be auto-destroyed. Pre-checks the dialog's ephemeral checkbox.",
        },
        reason: {
          type: "string",
          description:
            "One-sentence explanation shown to the user above the dialog form. E.g. 'I need a scratch project to draft a migration script for MongoDB 8.'",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "destroy_temp_project",
    description:
      "Tear down an ephemeral project the Manager previously created via propose_project (with ephemeral: true). Kills any running session, removes the registration, and deletes the on-disk directory if it lives under ~/.the-manager/temp/. Errors if the project is NOT ephemeral — call this only for scratch projects. Use this when your long task is done so the temp project doesn't linger.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Ephemeral project id." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  if (!isJsonRpcRequest(body)) {
    return rpcError(null, -32600, "invalid request");
  }
  const reqId = body.id ?? null;
  try {
    switch (body.method) {
      case "initialize":
        return rpcOk(reqId, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        // Notifications: spec says respond with 202 and no body when accepted over HTTP.
        return new Response(null, { status: 202 });
      case "ping":
        return rpcOk(reqId, {});
      case "tools/list":
        return rpcOk(reqId, { tools: TOOLS });
      case "tools/call": {
        const result = await callTool(body.params);
        return rpcOk(reqId, result);
      }
      default:
        return rpcError(reqId, -32601, `method not found: ${body.method}`);
    }
  } catch (err) {
    return rpcError(reqId, -32603, err instanceof Error ? err.message : String(err));
  }
}

// GET / DELETE / OPTIONS: we don't open server-initiated SSE streams.
export function GET() {
  return new Response("method not allowed (no SSE channel)", { status: 405 });
}

async function callTool(rawParams: unknown): Promise<ToolResult> {
  const params = (rawParams as { name?: string; arguments?: Record<string, unknown> }) ?? {};
  const name = params.name ?? "";
  const args = params.arguments ?? {};
  switch (name) {
    case "list_projects": {
      const projects = await repos.projects.list();
      const summary = projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        defaultDriver: p.defaultDriver,
        ephemeral: p.ephemeral,
        expiresAt: p.expiresAt,
        description: p.description,
      }));
      return textResult(JSON.stringify(summary, null, 2));
    }
    case "get_project_status": {
      const id = stringArg(args, "id");
      const status = listStatuses()[id] ?? { alive: false, lastActivityAt: null };
      return textResult(JSON.stringify(status, null, 2));
    }
    case "send_to_project": {
      const id = stringArg(args, "id");
      const text = stringArg(args, "text");
      // Track whether the session was already alive before this call. On a
      // cold spawn we type the prompt but deliberately skip the trailing
      // Enter so the user sees it in their input box and submits it
      // themselves — gives them a chance to review what the Manager is
      // about to ask the project agent to do.
      const wasAlive = getSession(id as ProjectId) !== null;
      // Auto-spawn if the user hasn't opened this project's terminal yet —
      // delegation shouldn't require the user to pre-click into a tab. The
      // pty is born at the driver's default size; when the user later opens
      // the tab the SSE route resizes it to match the rendered xterm.
      try {
        await getOrCreateSession(id as ProjectId, 120, 32);
      } catch (err) {
        return errorResult(
          `cannot spawn session for project ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Two writes with a short gap. Claude Code's TUI input uses Ink's paste
      // detection: a multi-char chunk arriving in one read is treated as a
      // paste, so a trailing `\r` becomes a newline in the input buffer rather
      // than a submit. Sending Enter as its own pty read makes claude see it
      // as a real Enter keystroke.
      const okText = writeInput(id as ProjectId, text);
      if (!okText) {
        return errorResult(`failed to write to session for project ${id}.`);
      }
      if (!wasAlive) {
        // Cold spawn: leave the prompt pre-filled in claude's input box for
        // the user to review and submit. No Enter.
        return textResult("spawned");
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      writeInput(id as ProjectId, "\r");
      return textResult("sent");
    }
    case "read_project_terminal": {
      const id = stringArg(args, "id");
      const rawLines = args.lines;
      const lines = clampInt(rawLines, 100, 1, 5000);
      const tail = readRecentLines(id as ProjectId, lines);
      if (tail === null) {
        return errorResult(`no live session for project ${id}.`);
      }
      return textResult(tail);
    }
    case "propose_project": {
      const payload = {
        name: optionalStringArg(args, "name"),
        path: optionalStringArg(args, "path"),
        defaultDriver: optionalDriverArg(args, "defaultDriver"),
        ephemeral: optionalBoolArg(args, "ephemeral"),
        reason: optionalStringArg(args, "reason"),
      };
      // For ephemeral proposals with no suggested path, fill in a fresh temp
      // dir under the safe root so the dialog opens with something the user
      // can confirm without typing.
      if (payload.ephemeral && !payload.path) {
        const id = randomUUID();
        payload.path = paths.tempProjectDir(id);
        if (!payload.name) payload.name = `temp-${id.slice(0, 8)}`;
      }
      const result = await enqueueProjectProposal(payload);
      if (result.kind === "cancelled") {
        return textResult(
          JSON.stringify({ kind: "cancelled", reason: result.reason ?? "user" }, null, 2),
        );
      }
      return textResult(
        JSON.stringify(
          {
            kind: "confirmed",
            project: {
              id: result.project.id,
              name: result.project.name,
              path: result.project.path,
              defaultDriver: result.project.defaultDriver,
              ephemeral: result.project.ephemeral,
              expiresAt: result.project.expiresAt,
            },
          },
          null,
          2,
        ),
      );
    }
    case "destroy_temp_project": {
      const id = stringArg(args, "id");
      let project: Awaited<ReturnType<typeof repos.projects.get>>;
      try {
        project = await repos.projects.get(id as ProjectId);
      } catch {
        return errorResult(`project ${id} not found.`);
      }
      if (!project.ephemeral) {
        return errorResult(
          `project ${id} is not ephemeral. Only Manager-created temp projects can be destroyed by this tool.`,
        );
      }
      const result = await destroyEphemeralProject(project);
      if (result.diskError) {
        return errorResult(
          `removed registration but failed to delete ${project.path}: ${result.diskError}`,
        );
      }
      return textResult(JSON.stringify(result, null, 2));
    }
    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`argument ${key} must be a string`);
  return v;
}

function optionalBoolArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`argument ${key} must be a boolean`);
  return v;
}

function optionalDriverArg(args: Record<string, unknown>, key: string): DriverId | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (v !== "claude" && v !== "codex" && v !== "gemini") {
    throw new Error(`argument ${key} must be one of claude|codex|gemini`);
  }
  return v;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`missing or non-string argument: ${key}`);
  return v;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (v as { method?: unknown }).method === "string"
  );
}

function rpcOk(id: number | string | null, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
