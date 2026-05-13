import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { repos } from "../../../lib/runtime";
import {
  getOrCreateSession,
  getSession,
  listStatuses,
  readRecentLines,
  writeInput,
} from "../../../lib/sessions";

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
      "List all projects The Manager knows about. Each entry has id, name, path, defaultDriver. Use the id with the other tools.",
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
    default:
      return errorResult(`unknown tool: ${name}`);
  }
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
