import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { AgentHandle } from "@the-manager/drivers";
import { PtyAgentDriver } from "@the-manager/drivers";
import { paths } from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import {
  appendChunk,
  attach as attachRecording,
  type DataSubscriber,
  type ExitSubscriber,
} from "./pty-recording";
import { MANAGER_PROJECT_ID } from "./runtime";

/**
 * General-purpose shell terminals — separate from the Claude pty registry in
 * `sessions.ts`. Multiple sessions per scope (a scope is either a real project
 * id or the synthetic Manager id). Each session is a plain `$SHELL` running
 * under a pty so the user can `git status`, `ls`, etc. without leaving the
 * app. The Claude flow is untouched.
 *
 * Lifecycle: client POSTs to spawn (server returns a uuid sessionId), then
 * attaches via SSE for output and POSTs for input/resize. Sessions survive
 * client navigation/refresh; only an explicit DELETE (or pty exit) removes
 * them from the registry. Dev-server restart empties the registry — same
 * caveat as the Claude registry; orphan ptys are not currently tracked.
 */

export type ScopeKey = string;
export type SessionId = string;

export interface ShellSession {
  id: SessionId;
  label: string;
  handle: AgentHandle;
  recording: string[];
  recordingBytes: number;
  dataSubs: Set<DataSubscriber>;
  exitSubs: Set<ExitSubscriber>;
  cols: number;
  rows: number;
  exited: boolean;
  createdAt: string;
}

interface ScopeEntry {
  sessions: Map<SessionId, ShellSession>;
  /** Monotonic per-scope counter for labels — does NOT collide with killed tabs. */
  labelCounter: number;
}

const REG_KEY = "__the_manager_terminals__";
type RegistryGlobal = typeof globalThis & {
  [REG_KEY]?: Map<ScopeKey, ScopeEntry>;
};
function registry(): Map<ScopeKey, ScopeEntry> {
  const g = globalThis as RegistryGlobal;
  if (!g[REG_KEY]) g[REG_KEY] = new Map();
  return g[REG_KEY];
}

function getOrInitScope(scope: ScopeKey): ScopeEntry {
  const reg = registry();
  let entry = reg.get(scope);
  if (!entry) {
    entry = { sessions: new Map(), labelCounter: 0 };
    reg.set(scope, entry);
  }
  return entry;
}

const shellCommand = process.env.SHELL ?? "/bin/zsh";

/**
 * Same SIGTERM → SIGKILL escalation as `sessions.ts`. A user-driven shell
 * (vim, less, a watch loop) can ignore SIGTERM just as easily as a wedged
 * claude REPL, so the force-kill safety net is identical.
 */
const FORCE_KILL_GRACE_MS = 3_000;

const driver = new PtyAgentDriver({
  id: "shell",
  command: shellCommand,
  baseArgs: [],
  baseEnv: { TERM: "xterm-256color" },
});

async function resolveScopeCwd(scope: ScopeKey): Promise<string> {
  if (scope === MANAGER_PROJECT_ID) {
    const cwd = paths.managerCwd();
    await mkdir(cwd, { recursive: true });
    return cwd;
  }
  // Imported lazily to avoid a circular dep with runtime.ts at module-load
  // time (runtime.ts pulls persistence which pulls a lot).
  const { repos } = await import("./runtime");
  const project = await repos.projects.get(scope as ProjectId);
  return project.path;
}

export interface SessionMeta {
  sessionId: SessionId;
  label: string;
  createdAt: string;
}

export async function createSession(
  scope: ScopeKey,
  cols: number,
  rows: number,
): Promise<SessionMeta> {
  const cwd = await resolveScopeCwd(scope);
  const entry = getOrInitScope(scope);
  entry.labelCounter += 1;
  const id = randomUUID();
  const label = `Terminal ${entry.labelCounter}`;
  const createdAt = new Date().toISOString();

  const handle = driver.spawn({ cwd, pty: { cols, rows } });
  const session: ShellSession = {
    id,
    label,
    handle,
    recording: [],
    recordingBytes: 0,
    dataSubs: new Set(),
    exitSubs: new Set(),
    cols,
    rows,
    exited: false,
    createdAt,
  };

  handle.on("data", ({ chunk }) => {
    appendChunk(session, chunk);
    for (const sub of session.dataSubs) sub(chunk);
  });

  handle.on("exit", () => {
    session.exited = true;
    const tombstone = "\r\n\x1b[2m[shell exited]\x1b[0m\r\n";
    for (const sub of session.dataSubs) sub(tombstone);
    for (const sub of session.exitSubs) sub();
    session.dataSubs.clear();
    session.exitSubs.clear();
    // Pull it out of the scope map so listSessions doesn't keep showing it.
    const e = registry().get(scope);
    if (e && e.sessions.get(id) === session) e.sessions.delete(id);
  });

  entry.sessions.set(id, session);
  return { sessionId: id, label, createdAt };
}

export function getSession(scope: ScopeKey, id: SessionId): ShellSession | null {
  const entry = registry().get(scope);
  if (!entry) return null;
  const s = entry.sessions.get(id);
  return s && !s.exited ? s : null;
}

export function listSessions(scope: ScopeKey): SessionMeta[] {
  const entry = registry().get(scope);
  if (!entry) return [];
  const out: SessionMeta[] = [];
  for (const s of entry.sessions.values()) {
    if (s.exited) continue;
    out.push({ sessionId: s.id, label: s.label, createdAt: s.createdAt });
  }
  // Stable order: oldest first matches user expectation of tab strip order.
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

export function writeInput(scope: ScopeKey, id: SessionId, data: string): boolean {
  const s = getSession(scope, id);
  if (!s) return false;
  s.handle.write(data);
  return true;
}

export function resize(scope: ScopeKey, id: SessionId, cols: number, rows: number): boolean {
  const s = getSession(scope, id);
  if (!s) return false;
  s.handle.resize(cols, rows);
  s.cols = cols;
  s.rows = rows;
  return true;
}

export function kill(scope: ScopeKey, id: SessionId): boolean {
  const entry = registry().get(scope);
  if (!entry) return false;
  const s = entry.sessions.get(id);
  if (!s) return false;
  s.handle.kill("SIGTERM");
  // The exit handler will delete from the map and mark exited; do it here too
  // so an immediate follow-up `listSessions` already reflects the kill.
  entry.sessions.delete(id);
  // Escalate to SIGKILL if SIGTERM is ignored. The session reference survives
  // the map deletion through this closure, which is exactly what we need.
  setTimeout(() => {
    try {
      s.handle.kill("SIGKILL");
    } catch {
      /* already exited */
    }
  }, FORCE_KILL_GRACE_MS).unref?.();
  return true;
}

/**
 * Send SIGTERM (or SIGKILL when `force: true`) to every live shell session in
 * every scope. Used by runtime.ts on process shutdown so we don't leave a
 * crowd of shell ptys running after the embedded Next server goes away.
 */
export function killAllTerminals(force = false): void {
  const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
  for (const entry of registry().values()) {
    for (const s of entry.sessions.values()) {
      if (s.exited) continue;
      try {
        s.handle.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }
}

export function attach(
  session: ShellSession,
  onData: DataSubscriber,
  onExit: ExitSubscriber,
): { initial: string[]; unsubscribe: () => void } {
  return attachRecording(session, onData, onExit);
}
