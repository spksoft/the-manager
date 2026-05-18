import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { GitView } from "@the-manager/git";
import { paths } from "@the-manager/persistence";
import type { DriverId, ProjectId } from "@the-manager/shared";
import { resolveProjectCwd } from "../../../lib/cwd";
import { enqueueAction } from "../../../lib/manager-actions";
import { enqueueProjectProposal } from "../../../lib/manager-requests";
import { emitNotification } from "../../../lib/notifications";
import { repos } from "../../../lib/runtime";
import {
  activitySnapshot,
  getOrCreateSession,
  getSession,
  listStatuses,
  readRecentLines,
  writeInput,
} from "../../../lib/sessions";
import { completeTask, createTask } from "../../../lib/tasks";
import { destroyEphemeralProject } from "../../../lib/temp-projects";
import { isProjectTrusted } from "../../../lib/trust";

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
      "Write text to a project's interactive claude terminal as if the user had typed it. If the project's claude session is already running, Enter is appended automatically (the prompt is submitted). If the session has to be cold-spawned by this call, the text is typed but Enter is NOT pressed — the prompt sits in the user's input box for them to review and submit. Returns `{ status: 'sent'|'spawned', taskId }`. Call `complete_task(taskId, summary)` once you've read the agent's reply and consider this unit of work done — that surfaces it in the journal.",
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
  // ── Read-only context tools (Phase 1.A1) ────────────────────────────────────
  // These let the Manager observe a project without typing into its terminal.
  // Write-side tools live behind the safe-mode Inbox in Phase 3.
  {
    name: "git_status",
    description:
      "Git status for a project: { isRepo, branch, ahead, behind, staged[], modified[], untracked[] }. Returns isRepo:false if the project root is not a git repo. Use this to summarise local changes before delegating.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Project id." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "git_log",
    description:
      "Recent commits for a project: Array<{ hash, author, date, subject }>. `limit` defaults to 20, max 200.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "git_diff",
    description:
      "Diff against HEAD (default) or a specific ref. Pass `ref: 'STAGED'` for staged-only. Output is capped at 64KB — when truncated the response includes `truncatedAt`.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        ref: {
          type: "string",
          description:
            "'HEAD' (default), 'STAGED' for the staged diff only, or any commit-ish (hash, branch, tag).",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file from a project. `path` must be relative to the project root; absolute paths and paths escaping the root are rejected. Output is capped at 256KB; when truncated the response includes `truncatedAt`. Use this to inspect source before suggesting changes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        path: { type: "string", description: "Path relative to the project root." },
      },
      required: ["id", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description:
      "Filename + content search over a project. Returns up to `limit` results (default 20, max 50) each shaped like { path, score, snippet? }. Mirrors what the in-app file picker uses.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        query: { type: "string", description: "Free-form search query." },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
      required: ["id", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_assets",
    description:
      "List shared / per-project assets the user has uploaded. Without `projectId` returns only global assets; pass a `projectId` to restrict to that project. Each entry: { id, filename, mime, sizeBytes, scope, folder, tags }.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Restrict to this project's scope. Omit for global assets only.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_asset",
    description:
      "Read a stored asset as UTF-8 text. Binary files return `{ truncated: true, content: '' }`. Output is capped at 256KB.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Asset id from list_assets." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "post_notification",
    description:
      "Surface a notification to the user's NotificationsBell. Use this to ping the user from a long-running orchestration (e.g. 'Project X finished migration'). `severity`: info | attention | urgent.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["info", "attention", "urgent"] },
        message: { type: "string", description: "One-line user-facing message." },
        projectId: {
          type: "string",
          description: "Optional project association so the bell deep-links there.",
        },
      },
      required: ["severity", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "list_active_sessions",
    description:
      "Snapshot of every live agent session right now: Array<{ scope, driver, state, lastActivityAt, preview }>. `state` is one of idle | working | needs_input. Use before sending a follow-up to avoid talking over a working agent.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description:
      "Mark a task as completed/failed/cancelled. Call this once you've finished orchestrating a unit of work that was started by `send_to_project` (or any other task-creating tool). On `completed`, the optional `summary` is appended to today's journal entry so future-you knows what got done.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task id returned by the tool that started the work.",
        },
        status: { type: "string", enum: ["completed", "failed", "cancelled"] },
        summary: {
          type: "string",
          description:
            "Short markdown summary of what was done. Only used when status is 'completed'.",
        },
        title: {
          type: "string",
          description:
            "Optional one-line title for the journal entry. Defaults to a truncation of the original task payload.",
        },
      },
      required: ["taskId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    description:
      "List Manager tasks (newest first). Useful before declaring something done — there may already be a task tracking it.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "running", "completed", "failed", "cancelled"],
          description: "Filter by status.",
        },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  // ── Write-side action tools (Phase 3) ───────────────────────────────────────
  // These either apply directly (project is trusted) or block on user approval
  // via the Inbox. Default for every project is "untrusted" — safe-mode on.
  {
    name: "write_file",
    description:
      "Write UTF-8 text to a file inside a project. If the project is in the user's trusted list, the write applies immediately; otherwise this call BLOCKS until the user approves the proposal in the Inbox (or 30 min timeout). `path` must be relative to the project root. The user sees the diff before approving. Always include a `reason` so the user understands the change.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        path: { type: "string", description: "Path relative to project root." },
        content: { type: "string", description: "New file content (UTF-8)." },
        reason: { type: "string", description: "One-sentence justification for the user." },
      },
      required: ["id", "path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command inside a project's cwd. Trusted projects execute immediately; otherwise this BLOCKS on Inbox approval. Output (stdout+stderr, capped at 64KB) and exit code are returned. Use this sparingly — for anything interactive prefer `send_to_project`.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        command: { type: "string", description: "Command to run via /bin/sh -c." },
        reason: { type: "string", description: "One-sentence justification for the user." },
        timeoutMs: { type: "number", minimum: 1000, maximum: 600_000 },
      },
      required: ["id", "command"],
      additionalProperties: false,
    },
  },
  {
    name: "fan_out_to_projects",
    description:
      "Send the same prompt to N project agents in parallel. Each target auto-spawns a session if needed. Returns Array<{ projectId, status: 'sent'|'spawned'|'error', taskId?, error? }>. Useful for cross-project operations like 'check the lint status everywhere'. Pass `submit: false` to type the prompt without pressing Enter on alive sessions (user reviews then submits).",
    inputSchema: {
      type: "object",
      properties: {
        projectIds: {
          type: "array",
          items: { type: "string" },
          description: "Project ids to fan out to.",
          minItems: 1,
        },
        text: { type: "string", description: "Prompt to send to every target." },
        submit: {
          type: "boolean",
          description:
            "When true (default), submits the prompt on alive sessions (Enter is appended). When false, types-without-submitting on every target so the user reviews.",
        },
      },
      required: ["projectIds", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "gather_tasks",
    description:
      "Wait for a batch of tasks (from fan_out_to_projects or send_to_project) to settle. Polls task status until all are finished (completed/failed/cancelled) or the timeout fires. Returns the final TaskRow[] in the order taskIds were given.",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
        timeoutMs: { type: "number", minimum: 1000, maximum: 600_000 },
      },
      required: ["taskIds"],
      additionalProperties: false,
    },
  },
  {
    name: "set_project_trust",
    description:
      "Mark a project as trusted (so future write/run tools apply without Inbox approval) or untrusted (back to safe-mode). Only the user normally toggles this in Settings, but Manager can call it after a successful round of approvals when the user explicitly asked to 'trust this project'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        trusted: { type: "boolean", description: "true to trust, false to revoke." },
      },
      required: ["id", "trusted"],
      additionalProperties: false,
    },
  },
];

const FILE_READ_BYTE_CAP = 256_000;
const DIFF_BYTE_CAP = 64_000;
const ASSET_READ_BYTE_CAP = 256_000;

/**
 * Resolve a project-relative path safely. Rejects absolute paths and any
 * resolved location that escapes the project root, even via symlinks.
 */
async function resolveProjectPath(cwd: string, relative: string): Promise<string> {
  if (isAbsolute(relative)) {
    throw new Error("path must be relative to the project root");
  }
  const joined = resolvePath(cwd, relative);
  let real: string;
  try {
    real = await realpath(joined);
  } catch {
    // The file might not exist yet (rare in read tools, but cheaper to keep
    // the check uniform). Fall back to the lexical resolve.
    real = joined;
  }
  const cwdReal = await realpath(cwd).catch(() => cwd);
  if (real !== cwdReal && !real.startsWith(`${cwdReal}/`) && !real.startsWith(`${cwdReal}\\`)) {
    throw new Error("path escapes project root");
  }
  return real;
}

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
      try {
        await getOrCreateSession(id as ProjectId, 120, 32);
      } catch (err) {
        return errorResult(
          `cannot spawn session for project ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const okText = writeInput(id as ProjectId, text);
      if (!okText) {
        return errorResult(`failed to write to session for project ${id}.`);
      }
      const task = await createTask({
        requestedBy: "manager",
        targetProjectId: id as ProjectId,
        targetSessionId: null,
        payload: text,
      });
      if (!wasAlive) {
        return textResult(JSON.stringify({ status: "spawned", taskId: task.id }, null, 2));
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      writeInput(id as ProjectId, "\r");
      return textResult(JSON.stringify({ status: "sent", taskId: task.id }, null, 2));
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
    case "git_status": {
      const id = stringArg(args, "id");
      const cwd = await resolveProjectCwd(id as ProjectId);
      const git = new GitView(cwd);
      if (!(await git.isRepository())) {
        return textResult(JSON.stringify({ isRepo: false }, null, 2));
      }
      const status = await git.status();
      const result = {
        isRepo: true,
        branch: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        untracked: status.not_added,
        deleted: status.deleted,
        conflicted: status.conflicted,
      };
      return textResult(JSON.stringify(result, null, 2));
    }
    case "git_log": {
      const id = stringArg(args, "id");
      const limit = clampInt(args.limit, 20, 1, 200);
      const cwd = await resolveProjectCwd(id as ProjectId);
      const git = new GitView(cwd);
      if (!(await git.isRepository())) {
        return errorResult(`project ${id} is not a git repo.`);
      }
      const log = await git.log(limit);
      const commits = log.all.map((c) => ({
        hash: c.hash,
        author: c.author_name,
        date: c.date,
        subject: c.message,
      }));
      return textResult(JSON.stringify(commits, null, 2));
    }
    case "git_diff": {
      const id = stringArg(args, "id");
      const ref = optionalStringArg(args, "ref");
      const cwd = await resolveProjectCwd(id as ProjectId);
      const git = new GitView(cwd);
      if (!(await git.isRepository())) {
        return errorResult(`project ${id} is not a git repo.`);
      }
      let diff: string;
      if (!ref || ref === "HEAD") {
        diff = await git.workingDiff();
      } else if (ref === "STAGED") {
        diff = await git.stagedDiff();
      } else {
        diff = await git.diff(ref);
      }
      const out = clampString(diff, DIFF_BYTE_CAP);
      return textResult(JSON.stringify(out, null, 2));
    }
    case "read_file": {
      const id = stringArg(args, "id");
      const relPath = stringArg(args, "path");
      const cwd = await resolveProjectCwd(id as ProjectId);
      let abs: string;
      try {
        abs = await resolveProjectPath(cwd, relPath);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
      let st: { isFile: () => boolean; size: number };
      try {
        st = await stat(abs);
      } catch {
        return errorResult(`file not found: ${relPath}`);
      }
      if (!st.isFile()) {
        return errorResult(`not a regular file: ${relPath}`);
      }
      const buf = await readFile(abs);
      const content = buf.toString("utf8").slice(0, FILE_READ_BYTE_CAP);
      const truncated = buf.byteLength > FILE_READ_BYTE_CAP;
      return textResult(
        JSON.stringify(
          {
            path: relPath,
            sizeBytes: st.size,
            content,
            truncated,
            truncatedAt: truncated ? FILE_READ_BYTE_CAP : undefined,
          },
          null,
          2,
        ),
      );
    }
    case "search_files": {
      const id = stringArg(args, "id");
      const query = stringArg(args, "query").trim();
      const limit = clampInt(args.limit, 20, 1, 50);
      if (query.length === 0) return errorResult("query is empty");
      const cwd = await resolveProjectCwd(id as ProjectId);
      const { walkProject } = await import("../../../lib/project-fs");
      const { files } = await walkProject(cwd, { maxFiles: 2000, budgetMs: 800 });
      const lower = query.toLowerCase();
      const ranked = files
        .map((f) => ({
          path: f.path,
          score: scoreNameMatch(f.path, lower),
        }))
        .filter((r): r is { path: string; score: number } => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return textResult(JSON.stringify(ranked, null, 2));
    }
    case "list_assets": {
      const projectIdArg = optionalStringArg(args, "projectId");
      const all = await repos.assets.list();
      const filtered = all.filter((a) => {
        if (projectIdArg) {
          return a.scope !== "global" && a.scope.projectId === projectIdArg;
        }
        return a.scope === "global";
      });
      const summary = filtered.map((a) => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        scope: a.scope,
        folder: a.folder,
        tags: a.tags,
      }));
      return textResult(JSON.stringify(summary, null, 2));
    }
    case "read_asset": {
      const id = stringArg(args, "id");
      const all = await repos.assets.list();
      const asset = all.find((a) => a.id === id);
      if (!asset) return errorResult(`asset ${id} not found.`);
      if (!asset.mime.startsWith("text/") && asset.mime !== "application/json") {
        return textResult(
          JSON.stringify(
            {
              id: asset.id,
              filename: asset.filename,
              mime: asset.mime,
              content: "",
              truncated: true,
            },
            null,
            2,
          ),
        );
      }
      const blobPath = paths.assetBlob(asset.sha256);
      const buf = await readFile(blobPath).catch(() => null);
      if (!buf) return errorResult(`asset ${id} blob is missing on disk.`);
      const content = buf.toString("utf8").slice(0, ASSET_READ_BYTE_CAP);
      const truncated = buf.byteLength > ASSET_READ_BYTE_CAP;
      return textResult(
        JSON.stringify(
          { id: asset.id, filename: asset.filename, mime: asset.mime, content, truncated },
          null,
          2,
        ),
      );
    }
    case "post_notification": {
      const severity = stringArg(args, "severity");
      const message = stringArg(args, "message");
      const projectIdArg = optionalStringArg(args, "projectId");
      if (severity !== "info" && severity !== "attention" && severity !== "urgent") {
        return errorResult("severity must be one of info | attention | urgent");
      }
      const { MANAGER_PROJECT_ID } = await import("../../../lib/manager-id");
      emitNotification({
        projectId: (projectIdArg ?? MANAGER_PROJECT_ID) as ProjectId,
        kind: "manager",
        severity,
        message,
      });
      return textResult(JSON.stringify({ posted: true }, null, 2));
    }
    case "list_active_sessions": {
      return textResult(JSON.stringify(activitySnapshot(), null, 2));
    }
    case "complete_task": {
      const taskId = stringArg(args, "taskId");
      const status = stringArg(args, "status");
      const summary = optionalStringArg(args, "summary");
      const title = optionalStringArg(args, "title");
      if (status !== "completed" && status !== "failed" && status !== "cancelled") {
        return errorResult("status must be one of completed | failed | cancelled");
      }
      const updated = await completeTask({
        taskId: taskId as ProjectId as unknown as import("@the-manager/shared").TaskId,
        status,
        result: summary,
        journalTitle: title,
      });
      if (!updated) return errorResult(`task ${taskId} not found.`);
      return textResult(JSON.stringify(updated, null, 2));
    }
    case "list_tasks": {
      const limit = clampInt(args.limit, 50, 1, 200);
      const filterStatus = optionalStringArg(args, "status");
      const rows = await repos.tasks.list();
      const filtered = rows
        .filter((t) => (filterStatus ? t.status === filterStatus : true))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
      return textResult(JSON.stringify(filtered, null, 2));
    }
    case "write_file": {
      const id = stringArg(args, "id");
      const relPath = stringArg(args, "path");
      const content = stringArg(args, "content");
      const reason = optionalStringArg(args, "reason");
      const cwd = await resolveProjectCwd(id as ProjectId);
      let abs: string;
      try {
        abs = await resolveProjectPath(cwd, relPath);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
      const previous = await readFile(abs, "utf8").catch(() => null);
      const trusted = await isProjectTrusted(id);
      if (!trusted) {
        const result = await enqueueAction({
          kind: "write_file",
          projectId: id,
          relPath,
          newContent: content,
          previousContent: previous,
          reason,
        });
        if (result.kind === "rejected") {
          return textResult(
            JSON.stringify({ applied: false, reason: result.reason ?? "user" }, null, 2),
          );
        }
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      return textResult(
        JSON.stringify(
          {
            applied: true,
            mode: trusted ? "auto" : "approved",
            bytes: Buffer.byteLength(content, "utf8"),
          },
          null,
          2,
        ),
      );
    }
    case "run_command": {
      const id = stringArg(args, "id");
      const command = stringArg(args, "command");
      const reason = optionalStringArg(args, "reason");
      const timeoutMs = clampInt(args.timeoutMs, 60_000, 1000, 600_000);
      const cwd = await resolveProjectCwd(id as ProjectId);
      const trusted = await isProjectTrusted(id);
      if (!trusted) {
        const result = await enqueueAction({
          kind: "run_command",
          projectId: id,
          command,
          cwd,
          reason,
        });
        if (result.kind === "rejected") {
          return textResult(
            JSON.stringify({ ran: false, reason: result.reason ?? "user" }, null, 2),
          );
        }
      }
      const out = await runShellCommand(command, cwd, timeoutMs);
      return textResult(JSON.stringify(out, null, 2));
    }
    case "set_project_trust": {
      const id = stringArg(args, "id");
      const v = args.trusted;
      if (typeof v !== "boolean") return errorResult("trusted must be a boolean");
      const { setProjectTrust } = await import("../../../lib/trust");
      await setProjectTrust(id, v);
      return textResult(JSON.stringify({ id, trusted: v }, null, 2));
    }
    case "fan_out_to_projects": {
      const ids = args.projectIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string")) {
        return errorResult("projectIds must be a non-empty array of strings");
      }
      const text = stringArg(args, "text");
      const submit = optionalBoolArg(args, "submit");
      const submitOnAlive = submit !== false;
      const results = await Promise.all(
        (ids as string[]).map(async (id) => {
          const wasAlive = getSession(id as ProjectId) !== null;
          try {
            await getOrCreateSession(id as ProjectId, 120, 32);
          } catch (err) {
            return {
              projectId: id,
              status: "error" as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
          const ok = writeInput(id as ProjectId, text);
          if (!ok) {
            return { projectId: id, status: "error" as const, error: "write failed" };
          }
          const task = await createTask({
            requestedBy: "manager",
            targetProjectId: id as ProjectId,
            targetSessionId: null,
            payload: text,
          });
          if (wasAlive && submitOnAlive) {
            await new Promise((resolve) => setTimeout(resolve, 80));
            writeInput(id as ProjectId, "\r");
            return { projectId: id, status: "sent" as const, taskId: task.id };
          }
          return { projectId: id, status: "spawned" as const, taskId: task.id };
        }),
      );
      return textResult(JSON.stringify(results, null, 2));
    }
    case "gather_tasks": {
      const ids = args.taskIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string")) {
        return errorResult("taskIds must be a non-empty array of strings");
      }
      const timeoutMs = clampInt(args.timeoutMs, 120_000, 1000, 600_000);
      const deadline = Date.now() + timeoutMs;
      const terminal = new Set(["completed", "failed", "cancelled"]);
      const taskIdList = ids as string[];
      while (Date.now() < deadline) {
        const rows = await repos.tasks.list();
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = taskIdList.map((id) => byId.get(id) ?? null);
        const allDone = ordered.every((r) => r !== null && terminal.has(r.status));
        if (allDone) {
          return textResult(JSON.stringify(ordered, null, 2));
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      const rows = await repos.tasks.list();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = taskIdList.map((id) => byId.get(id) ?? null);
      return textResult(JSON.stringify({ timedOut: true, tasks: ordered }, null, 2));
    }
    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

interface RunCommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

const RUN_OUTPUT_CAP = 64_000;

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<RunCommandResult> {
  const started = Date.now();
  return await new Promise<RunCommandResult>((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* */
      }
    }, timeoutMs);
    const accumulate = (which: "stdout" | "stderr", buf: Buffer) => {
      const target = which === "stdout" ? stdout : stderr;
      if (target.length >= RUN_OUTPUT_CAP) {
        truncated = true;
        return;
      }
      const remaining = RUN_OUTPUT_CAP - target.length;
      const chunk = buf.toString("utf8");
      if (chunk.length > remaining) {
        if (which === "stdout") stdout = target + chunk.slice(0, remaining);
        else stderr = target + chunk.slice(0, remaining);
        truncated = true;
      } else {
        if (which === "stdout") stdout = target + chunk;
        else stderr = target + chunk;
      }
    };
    child.stdout.on("data", (buf: Buffer) => accumulate("stdout", buf));
    child.stderr.on("data", (buf: Buffer) => accumulate("stderr", buf));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: code,
        stdout,
        stderr,
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: null,
        stdout,
        stderr: stderr || (err instanceof Error ? err.message : String(err)),
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Filename-only score in [0,1]. 0 means no match. */
function scoreNameMatch(path: string, lowerQuery: string): number {
  const hay = path.toLowerCase();
  const idx = hay.indexOf(lowerQuery);
  if (idx === -1) {
    let qi = 0;
    for (let i = 0; i < hay.length && qi < lowerQuery.length; i++) {
      if (hay[i] === lowerQuery[qi]) qi++;
    }
    return qi === lowerQuery.length ? 0.2 : 0;
  }
  const slash = hay.lastIndexOf("/");
  const basename = slash === -1 ? hay : hay.slice(slash + 1);
  if (basename === lowerQuery) return 1;
  if (basename.startsWith(lowerQuery)) return 0.9;
  if (basename.includes(lowerQuery)) return 0.75;
  return 0.5;
}

function clampString(
  s: string,
  cap: number,
): { content: string; truncated: boolean; truncatedAt?: number } {
  if (s.length <= cap) return { content: s, truncated: false };
  return { content: s.slice(0, cap), truncated: true, truncatedAt: cap };
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
