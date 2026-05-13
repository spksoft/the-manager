import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentHandle } from "@the-manager/drivers";
import { ClaudeDriver } from "@the-manager/drivers";
import { paths } from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import { MANAGER_PROJECT_ID, repos } from "./runtime";

/**
 * Long-lived interactive Claude sessions, one per projectId (and one for the
 * Manager). Each session is a single `claude` REPL running under a pty; the
 * browser/Electron client attaches to it through xterm.js. We never spawn a
 * fresh process per message — the whole point of the interactive path is to
 * keep the conversation in-process.
 *
 * On reconnect, we replay a bounded recording of the pty's prior bytes so a
 * fresh xterm renders the existing screen state, then subscribe for live
 * updates.
 */

export type DataSubscriber = (chunk: string) => void;
export type ExitSubscriber = () => void;

export interface Session {
  handle: AgentHandle;
  /** Recent pty output. Newest at the end; older chunks evicted past the cap. */
  recording: string[];
  recordingBytes: number;
  dataSubs: Set<DataSubscriber>;
  exitSubs: Set<ExitSubscriber>;
  cols: number;
  rows: number;
  /** True once the pty exited; no further data will be emitted. */
  exited: boolean;
  /** ISO timestamp of the most recent stdout chunk, or session start if none yet. */
  lastActivityAt: string;
}

export interface SessionStatus {
  alive: boolean;
  lastActivityAt: string | null;
}

/** Cap the in-memory recording so a very chatty session doesn't grow forever. */
const MAX_RECORDING_BYTES = 1_000_000;

const REG_KEY = "__the_manager_sessions__";
type RegistryGlobal = typeof globalThis & { [REG_KEY]?: Map<string, Session> };
function registry(): Map<string, Session> {
  const g = globalThis as RegistryGlobal;
  if (!g[REG_KEY]) g[REG_KEY] = new Map();
  return g[REG_KEY];
}

const driver = new ClaudeDriver();

async function resolveCwd(projectId: ProjectId): Promise<string> {
  if (projectId === MANAGER_PROJECT_ID) {
    const cwd = paths.managerCwd();
    await mkdir(cwd, { recursive: true });
    await ensureManagerWorkspace(cwd);
    return cwd;
  }
  const project = await repos.projects.get(projectId);
  return project.path;
}

/**
 * One-stop bootstrap for the Manager's cwd. Idempotent — safe to call on
 * every Manager spawn. Performs three things:
 *
 *   1. Writes / merges `.mcp.json` so Claude Code's MCP client connects to our
 *      in-process bridge (`/api/mcp`). Project-scoped MCP config lives in
 *      `.mcp.json`, NOT `.claude/settings.local.json` (the latter has a
 *      different schema and silently ignores `mcpServers`).
 *   2. Writes `CLAUDE.md` if absent — this is the operating brief Claude reads
 *      on startup. Tells the Manager what it is, which MCP tools it has, and
 *      how to coordinate across projects. We never overwrite an existing
 *      CLAUDE.md so the user is free to customise.
 *   3. Strips any stale `mcpServers` entry from `.claude/settings.local.json`
 *      that older versions of this app wrote there by mistake.
 *
 * The bridge URL defaults to `http://localhost:3000/api/mcp`; override via
 * `THE_MANAGER_MCP_URL` (e.g. when the web server runs on a non-default port).
 */
async function ensureManagerWorkspace(cwd: string): Promise<void> {
  const url = process.env.THE_MANAGER_MCP_URL ?? "http://localhost:3000/api/mcp";

  // 1. .mcp.json — merge our entry, keep anything else the user added by hand.
  const mcpFile = join(cwd, ".mcp.json");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(mcpFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") existing = parsed as Record<string, unknown>;
  } catch {
    /* no existing file or unreadable JSON — start fresh */
  }
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  servers["the-manager"] = { type: "http", url };
  existing.mcpServers = servers;
  await writeFile(mcpFile, `${JSON.stringify(existing, null, 2)}\n`, "utf8");

  // 2. CLAUDE.md — operating brief for the Manager agent. Only write if missing
  // so user edits survive.
  const claudeMdFile = join(cwd, "CLAUDE.md");
  let claudeMdExists = false;
  try {
    await readFile(claudeMdFile, "utf8");
    claudeMdExists = true;
  } catch {
    /* not present — we'll write it */
  }
  if (!claudeMdExists) {
    await writeFile(claudeMdFile, MANAGER_CLAUDE_MD, "utf8");
  }

  // 3. Strip the misplaced mcpServers entry from any old settings.local.json.
  const staleFile = join(cwd, ".claude", "settings.local.json");
  try {
    const raw = await readFile(staleFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "mcpServers" in parsed) {
      delete parsed.mcpServers;
      await writeFile(staleFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    }
  } catch {
    /* missing or unreadable — nothing to clean up */
  }
}

/**
 * Operating brief seeded into the Manager's cwd as `CLAUDE.md`. Claude Code
 * picks this up automatically on startup. Kept short and behavioral — long
 * directives get ignored.
 */
const MANAGER_CLAUDE_MD = `# The Manager

You are the **Manager** agent inside *The Manager*, a meta-agent app that
coordinates other Claude Code sessions across the user's registered projects.
Your job is to listen to what the user wants done, figure out which project(s)
it touches, and dispatch the work through the per-project agents — not to edit
project files yourself from this cwd.

## Tools you have here

The MCP server **\`the-manager\`** is wired up via \`.mcp.json\` in this cwd.
It exposes four tools:

- **\`list_projects()\`** — every project the user has registered. Returns id,
  name, path, defaultDriver. Call this first when you need to resolve a
  project by its short name.
- **\`get_project_status(id)\`** — \`{ alive, lastActivityAt }\` for a
  project's claude session. \`alive: false\` means the user hasn't opened that
  project's terminal in the UI yet; you cannot send to it until they do.
- **\`send_to_project(id, text)\`** — writes \`text\` (plus Enter) into a
  project's interactive terminal as if the user typed it. This is how you
  delegate.
- **\`read_project_terminal(id, lines?)\`** — tail of the project agent's
  recent pty output. Use this to check on progress before following up.

## Operating principles

- **Coordinate, don't duplicate.** Each per-project agent has its own
  CLAUDE.md and tool access scoped to that project. Don't open or edit project
  files from this cwd — ask the project agent.
- **List before acting.** If the user names a project ambiguously, call
  \`list_projects\` and confirm the id.
- **Check liveness before sending.** Call \`get_project_status\` before
  \`send_to_project\`. If a session isn't alive, tell the user to open that
  project's terminal in the UI; you can't spawn it for them.
- **Read before re-sending.** After dispatching non-trivial work, use
  \`read_project_terminal\` before sending a follow-up — the project agent's
  last reply usually answers the next question.
- **Treat the terminal as visible to the user.** Whatever you send via
  \`send_to_project\` is displayed in their UI; don't echo secrets.

## Your own workspace

This cwd (\`~/.the-manager/manager/cwd\`) is your private scratch space — fine
for notes, research output, intermediate files, anything not tied to a specific
project. Project work goes through the project agents.
`;

async function createSession(projectId: ProjectId, cols: number, rows: number): Promise<Session> {
  const cwd = await resolveCwd(projectId);
  const handle = driver.spawn({ cwd, pty: { cols, rows } });
  const session: Session = {
    handle,
    recording: [],
    recordingBytes: 0,
    dataSubs: new Set(),
    exitSubs: new Set(),
    cols,
    rows,
    exited: false,
    lastActivityAt: new Date().toISOString(),
  };

  handle.on("data", ({ chunk }) => {
    session.recording.push(chunk);
    session.recordingBytes += chunk.length;
    session.lastActivityAt = new Date().toISOString();
    while (session.recordingBytes > MAX_RECORDING_BYTES && session.recording.length > 1) {
      const dropped = session.recording.shift();
      if (dropped) session.recordingBytes -= dropped.length;
    }
    for (const sub of session.dataSubs) sub(chunk);
  });

  handle.on("exit", () => {
    session.exited = true;
    const tombstone = "\r\n\x1b[2m[claude exited]\x1b[0m\r\n";
    for (const sub of session.dataSubs) sub(tombstone);
    for (const sub of session.exitSubs) sub();
    session.dataSubs.clear();
    session.exitSubs.clear();
    if (registry().get(projectId) === session) registry().delete(projectId);
  });

  return session;
}

/**
 * Get or spawn the session for a project. The caller must pass the terminal
 * dimensions it's about to render at — the pty is sized correctly on first
 * spawn so claude's TUI doesn't render at default 80×24 and then jump.
 */
export async function getOrCreateSession(
  projectId: ProjectId,
  cols: number,
  rows: number,
): Promise<Session> {
  const reg = registry();
  const existing = reg.get(projectId);
  if (existing && !existing.exited) {
    if (existing.cols !== cols || existing.rows !== rows) {
      existing.handle.resize(cols, rows);
      existing.cols = cols;
      existing.rows = rows;
    }
    return existing;
  }
  const fresh = await createSession(projectId, cols, rows);
  reg.set(projectId, fresh);
  return fresh;
}

export function getSession(projectId: ProjectId): Session | null {
  const s = registry().get(projectId);
  return s && !s.exited ? s : null;
}

export function writeInput(projectId: ProjectId, data: string): boolean {
  const s = getSession(projectId);
  if (!s) return false;
  s.handle.write(data);
  return true;
}

export function resize(projectId: ProjectId, cols: number, rows: number): boolean {
  const s = getSession(projectId);
  if (!s) return false;
  s.handle.resize(cols, rows);
  s.cols = cols;
  s.rows = rows;
  return true;
}

export function endSession(projectId: ProjectId): void {
  const reg = registry();
  const s = reg.get(projectId);
  if (!s) return;
  s.handle.kill("SIGTERM");
  reg.delete(projectId);
}

/**
 * Tail of the recording buffer for the MCP bridge. Returns the last `lines`
 * lines (or fewer if the recording is shorter); returns null if no session
 * exists.
 */
export function readRecentLines(projectId: ProjectId, lines: number): string | null {
  const s = getSession(projectId);
  if (!s) return null;
  const text = s.recording.join("");
  const split = text.split("\n");
  return split.slice(-lines).join("\n");
}

/**
 * Snapshot of every live or recently-exited session for the sidebar status
 * dots. Returns one entry per projectId currently in the registry.
 */
export function listStatuses(): Record<string, SessionStatus> {
  const out: Record<string, SessionStatus> = {};
  for (const [projectId, s] of registry()) {
    out[projectId] = {
      alive: !s.exited,
      lastActivityAt: s.lastActivityAt,
    };
  }
  return out;
}

/**
 * Snapshot the current recording and subscribe to live output in a single
 * synchronous step — guarantees no chunk is duplicated or missed on attach.
 * The exit callback fires once when the pty terminates so the caller can
 * tear its transport down cleanly.
 */
export function attach(
  session: Session,
  onData: DataSubscriber,
  onExit: ExitSubscriber,
): { initial: string[]; unsubscribe: () => void } {
  const initial = session.recording.slice();
  session.dataSubs.add(onData);
  session.exitSubs.add(onExit);
  return {
    initial,
    unsubscribe: () => {
      session.dataSubs.delete(onData);
      session.exitSubs.delete(onExit);
    },
  };
}
