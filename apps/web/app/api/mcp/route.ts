import "server-only";
import { randomUUID } from "node:crypto";
import {
  appendMemory,
  listMemoryScopes,
  type MemoryScope,
  paths,
  readMemory,
  writeMemory,
} from "@the-manager/persistence";
import type { DriverId, ProjectId } from "@the-manager/shared";
import { enqueueProjectProposal } from "../../../lib/manager-requests";
import {
  getProjectGitLog,
  getProjectGitStatus,
  listProjectFiles,
  readProjectFile,
  searchProject,
} from "../../../lib/project-awareness";
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
 *   - get_project_git_status / get_project_git_log: read-only git introspection
 *     so the Manager doesn't have to round-trip through `send_to_project` to
 *     answer "what branch / what's dirty / what's recent".
 *   - list_project_files / read_project_file / search_project: read-only fs
 *     introspection over a project's working tree. Honors the same IGNORED
 *     set the Files tab uses, and refuses paths that escape the project root.
 *   - memory_read / memory_write / memory_append / memory_list: long-term
 *     memory the Manager keeps in `~/.the-manager/manager/memory/`. Scoped
 *     either globally (`global.md`) or per-project (`projects/<id>.md`); no
 *     memory file is ever written inside a user project directory.
 *   - set_project_tags / find_projects: routing labels. Tags live on the
 *     project row (no extra files) so they survive across sessions and
 *     restarts without writing anything into the project directory.
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
  {
    name: "get_project_git_status",
    description:
      "Read-only git status for a project. Returns `{ isRepo, branch, upstream, ahead, behind, dirty, staged[], modified[], untracked[], deleted[], conflicted[] }`. `dirty` is the total count across categories — 0 means a clean tree. `isRepo: false` if the project's directory isn't a git repo (no error). Cheap; safe to call before deciding whether to delegate work that depends on a clean tree.",
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
    name: "get_project_git_log",
    description:
      "Recent commits for a project. Returns `{ isRepo, branch, commits: [{ hash, date, author, subject }, ...] }` newest-first. `limit` defaults to 10, max 100. `isRepo: false` if the project isn't a git repo (no error).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        limit: {
          type: "number",
          description: "Number of commits to return. Default 10, max 100.",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_project_files",
    description:
      'List files and directories inside a project, optionally rooted at a subdirectory. Honors the standard ignore set (node_modules, .git, .next, dist, etc.). Returns `{ root, entries: [{ path, type, sizeBytes? }, ...], truncated }`, dirs first, capped at 500 entries. `subdir` is project-relative (default `""` = project root); `depth` is how many directory levels below `subdir` to descend (default 2, max 5). Use this to orient yourself in a project before reading specific files.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        subdir: {
          type: "string",
          description:
            "Project-relative subdirectory to root the listing at. Default project root.",
        },
        depth: {
          type: "number",
          description: "How many directory levels to descend. Default 2, max 5.",
          minimum: 0,
          maximum: 5,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "read_project_file",
    description:
      "Read a text file from a project. Returns `{ path, sizeBytes, mtime, content, truncated }`. `path` is project-relative — paths that escape the project root are rejected. Content is decoded as UTF-8 and capped at `maxBytes` (default 32 KB, max 256 KB); `truncated: true` means the file was larger than the cap and only the first `maxBytes` were returned.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        path: {
          type: "string",
          description: "Project-relative file path (must not escape the project root).",
        },
        maxBytes: {
          type: "number",
          description: "Cap on returned bytes. Default 32768, max 262144.",
          minimum: 1,
          maximum: 262144,
        },
      },
      required: ["id", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_project",
    description:
      'Search a project\'s working tree. `mode: "name"` (default) ranks files by filename match; `mode: "content"` greps file contents and returns short snippets. Returns `{ query, mode, results: [{ path, score, matches?: [{ line, col, preview }] }, ...], truncated }`. Best for orienting yourself before calling `read_project_file` or before deciding which project to delegate to. `limit` defaults to 20, max 50.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        query: {
          type: "string",
          description: "Search string (minimum 2 chars).",
          minLength: 2,
        },
        mode: {
          type: "string",
          enum: ["name", "content"],
          description: "`name` = filename match (cheap). `content` = grep file bodies.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results. Default 20, max 50.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: ["id", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_read",
    description:
      "Read a memory file. Omit `projectId` for the global memory (`~/.the-manager/manager/memory/global.md`); pass `projectId` for per-project memory (`projects/<id>.md`). Returns `{ scope, exists, content, sizeBytes, mtime }`. `exists: false` (with empty `content`) is normal — no error — when nothing has been written yet. Call this on the first message of every session to refresh long-term context.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id for per-project memory. Omit for global memory.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_append",
    description:
      "Append a note to a memory file. Omit `projectId` for global memory; pass `projectId` for per-project memory. Inserts a timestamped block (optionally with an `## <heading>`) so the file stays browsable. Use this for incremental observations during a session (decisions made, user preferences observed, gotchas worth remembering). Returns the new size + mtime.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id for per-project memory. Omit for global memory.",
        },
        text: {
          type: "string",
          description: "Markdown body to append (a timestamp is added for you).",
        },
        heading: {
          type: "string",
          description: "Optional short heading; rendered as `## <heading>` above the timestamp.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_write",
    description:
      "Replace a memory file's entire contents. Use sparingly — `memory_append` is safer because it preserves history. Omit `projectId` for global memory. Useful when you've decided to restructure the file (e.g. consolidate fragments under new headings). Returns the new size + mtime.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id for per-project memory. Omit for global memory.",
        },
        content: {
          type: "string",
          description: "Full new contents (markdown). Replaces whatever was there.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_list",
    description:
      "Index of every memory file. Returns `{ global: { exists, sizeBytes, mtime }, projects: [{ projectId, exists, sizeBytes, mtime }, ...] }`. Only summarises projects that are currently registered — orphan memory files (from removed projects) are not listed. Use this to decide whether to load a particular per-project memory or not.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "set_project_tags",
    description:
      "Replace a project's tags. Tags are free-form labels (e.g. `infra`, `frontend`, `prod`) the user or the Manager uses to route work. Pass the full new list — this is a replacement, not a merge; pass `[]` to clear. Whitespace is trimmed and duplicates (case-insensitive) are dropped server-side. Returns the updated project row.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project id." },
        tags: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 40 },
          maxItems: 20,
          description: "Full replacement list. Empty array clears all tags.",
        },
      },
      required: ["id", "tags"],
      additionalProperties: false,
    },
  },
  {
    name: "find_projects",
    description:
      'Filter `list_projects` server-side. All filters are AND-ed; omitting a filter means "any". `tags` matches a project that has every listed tag (case-insensitive). `namePattern` / `pathPattern` are substring matches against the project\'s name / path (case-insensitive, not regex). Returns the same shape as `list_projects` (id, name, path, defaultDriver, ephemeral, expiresAt, description, tags) for matched rows. Cheaper than pulling everything from `list_projects` and re-filtering when the user gives a routing hint like "the frontend project".',
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Match projects that have ALL of these tags (case-insensitive).",
        },
        namePattern: {
          type: "string",
          description: "Case-insensitive substring match against the project name.",
        },
        pathPattern: {
          type: "string",
          description: "Case-insensitive substring match against the project path.",
        },
      },
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
      return textResult(JSON.stringify(projects.map(summariseProject), null, 2));
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
    case "get_project_git_status": {
      const id = stringArg(args, "id");
      try {
        const summary = await getProjectGitStatus(id as ProjectId);
        return textResult(JSON.stringify(summary, null, 2));
      } catch (err) {
        return errorResult(`get_project_git_status failed: ${errMsg(err)}`);
      }
    }
    case "get_project_git_log": {
      const id = stringArg(args, "id");
      const limit = clampInt(args.limit, 10, 1, 100);
      try {
        const summary = await getProjectGitLog(id as ProjectId, limit);
        return textResult(JSON.stringify(summary, null, 2));
      } catch (err) {
        return errorResult(`get_project_git_log failed: ${errMsg(err)}`);
      }
    }
    case "list_project_files": {
      const id = stringArg(args, "id");
      const subdir = optionalStringArg(args, "subdir") ?? "";
      const depth = clampInt(args.depth, 2, 0, 5);
      try {
        const tree = await listProjectFiles(id as ProjectId, subdir, depth);
        return textResult(JSON.stringify(tree, null, 2));
      } catch (err) {
        return errorResult(`list_project_files failed: ${errMsg(err)}`);
      }
    }
    case "read_project_file": {
      const id = stringArg(args, "id");
      const path = stringArg(args, "path");
      const maxBytes = clampInt(args.maxBytes, 32 * 1024, 1, 256 * 1024);
      try {
        const file = await readProjectFile(id as ProjectId, path, maxBytes);
        return textResult(JSON.stringify(file, null, 2));
      } catch (err) {
        return errorResult(`read_project_file failed: ${errMsg(err)}`);
      }
    }
    case "search_project": {
      const id = stringArg(args, "id");
      const query = stringArg(args, "query");
      if (query.length < 2) {
        return errorResult("search_project query must be at least 2 characters.");
      }
      const modeRaw = optionalStringArg(args, "mode");
      const mode: "name" | "content" = modeRaw === "content" ? "content" : "name";
      const limit = clampInt(args.limit, 20, 1, 50);
      try {
        const summary = await searchProject(id as ProjectId, query, mode, limit);
        return textResult(JSON.stringify(summary, null, 2));
      } catch (err) {
        return errorResult(`search_project failed: ${errMsg(err)}`);
      }
    }
    case "memory_read": {
      const scope = memoryScopeArg(args);
      try {
        const result = await readMemory(scope);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(`memory_read failed: ${errMsg(err)}`);
      }
    }
    case "memory_append": {
      const scope = memoryScopeArg(args);
      const text = stringArg(args, "text");
      const heading = optionalStringArg(args, "heading");
      try {
        const result = await appendMemory(scope, text, heading);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(`memory_append failed: ${errMsg(err)}`);
      }
    }
    case "memory_write": {
      const scope = memoryScopeArg(args);
      const content = stringArg(args, "content");
      try {
        const result = await writeMemory(scope, content);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(`memory_write failed: ${errMsg(err)}`);
      }
    }
    case "memory_list": {
      try {
        const projects = await repos.projects.list();
        const result = await listMemoryScopes(projects.map((p) => p.id));
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(`memory_list failed: ${errMsg(err)}`);
      }
    }
    case "set_project_tags": {
      const id = stringArg(args, "id");
      const rawTags = args.tags;
      if (!Array.isArray(rawTags)) {
        return errorResult("set_project_tags: `tags` must be an array of strings.");
      }
      const tags: string[] = [];
      const seen = new Set<string>();
      for (const t of rawTags) {
        if (typeof t !== "string") {
          return errorResult("set_project_tags: every tag must be a string.");
        }
        const trimmed = t.trim();
        if (trimmed.length === 0 || trimmed.length > 40) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(trimmed);
      }
      if (tags.length > 20) tags.length = 20;
      try {
        const updated = await repos.projects.update(id as ProjectId, { tags });
        return textResult(JSON.stringify(summariseProject(updated), null, 2));
      } catch (err) {
        return errorResult(`set_project_tags failed: ${errMsg(err)}`);
      }
    }
    case "find_projects": {
      const rawTags = args.tags;
      const wantedTags: string[] = [];
      if (Array.isArray(rawTags)) {
        for (const t of rawTags) {
          if (typeof t === "string" && t.trim().length > 0) {
            wantedTags.push(t.trim().toLowerCase());
          }
        }
      }
      const namePattern = optionalStringArg(args, "namePattern")?.toLowerCase();
      const pathPattern = optionalStringArg(args, "pathPattern")?.toLowerCase();
      try {
        const projects = await repos.projects.list();
        const matched = projects.filter((p) => {
          if (namePattern && !p.name.toLowerCase().includes(namePattern)) return false;
          if (pathPattern && !p.path.toLowerCase().includes(pathPattern)) return false;
          if (wantedTags.length > 0) {
            const have = new Set(p.tags.map((t) => t.toLowerCase()));
            for (const w of wantedTags) {
              if (!have.has(w)) return false;
            }
          }
          return true;
        });
        return textResult(JSON.stringify(matched.map(summariseProject), null, 2));
      } catch (err) {
        return errorResult(`find_projects failed: ${errMsg(err)}`);
      }
    }
    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

/**
 * The compact shape we expose to the Manager via list_projects / find_projects.
 * Keeping it in one place so the two tools (and any future variants) can't
 * drift apart.
 */
function summariseProject(p: Awaited<ReturnType<typeof repos.projects.get>>) {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    defaultDriver: p.defaultDriver,
    ephemeral: p.ephemeral,
    expiresAt: p.expiresAt,
    description: p.description,
    tags: p.tags,
  };
}

/**
 * `projectId` arg is optional — its presence picks per-project scope, its
 * absence picks global. Centralised here so all four memory tools agree on
 * the convention.
 */
function memoryScopeArg(args: Record<string, unknown>): MemoryScope {
  const projectId = optionalStringArg(args, "projectId");
  if (projectId === undefined) return "global";
  return { projectId };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
