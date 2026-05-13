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
    await ensureManagerMcpSettings(cwd);
    return cwd;
  }
  const project = await repos.projects.get(projectId);
  return project.path;
}

/**
 * Ensure the Manager's cwd contains a `.mcp.json` that wires the in-process
 * MCP bridge (`/api/mcp`). Claude Code reads project-scoped MCP servers from
 * `.mcp.json` — NOT from `.claude/settings.local.json`, which carries a
 * different schema (permissions / env / etc.) and silently ignores
 * `mcpServers` entries.
 *
 * We merge non-destructively so the user can hand-add more servers without
 * having them overwritten on every Manager spawn. The bridge URL defaults to
 * `http://localhost:3000/api/mcp`; override via `THE_MANAGER_MCP_URL`.
 *
 * If a stale `.claude/settings.local.json` exists from an earlier version that
 * wrote `mcpServers` there, we strip the entry so it doesn't mislead anyone
 * grepping the file.
 */
async function ensureManagerMcpSettings(cwd: string): Promise<void> {
  const url = process.env.THE_MANAGER_MCP_URL ?? "http://localhost:3000/api/mcp";

  // Primary: .mcp.json at the cwd root.
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

  // Cleanup: earlier versions misplaced the entry inside settings.local.json.
  // Strip it so the file's mcpServers key doesn't mislead future readers.
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
