import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentHandle } from "@the-manager/drivers";
import { ClaudeDriver } from "@the-manager/drivers";
import { paths } from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import { emitNotification } from "./notifications";
import {
  appendChunk,
  attach as attachRecording,
  type DataSubscriber,
  type ExitSubscriber,
} from "./pty-recording";
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

export type { DataSubscriber, ExitSubscriber } from "./pty-recording";

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
  /**
   * State machine:
   *  - "idle": waiting for user input, no pending work
   *  - "working": user submitted, agent producing output
   *  - "needs_input": agent stopped producing because it's blocking on a
   *    permission/confirmation prompt; user attention is required mid-flow
   *
   * Transitions working → idle bump `readyAt` so the UI can surface a "ready"
   * notification. needs_input is detected via a TUI prompt heuristic in the
   * data handler and cleared on any subsequent user keystroke.
   */
  state: "idle" | "working" | "needs_input";
  /** Bumped each time the agent transitions from working to idle. */
  readyAt: string | null;
  /** Pending timeout that flips state back to idle after a quiet period. */
  idleTimer: NodeJS.Timeout | null;
}

export interface SessionStatus {
  alive: boolean;
  lastActivityAt: string | null;
  /** Bumped on each working → idle transition; the UI uses this to fire a notification. */
  readyAt: string | null;
}

/**
 * How long the pty has to stay quiet after the agent was last producing output
 * before we declare it "idle / ready for input". 2s is long enough that brief
 * pauses mid-response don't fire false notifications, short enough to feel
 * responsive when the agent actually finishes.
 */
const IDLE_QUIET_MS = 2_000;

/**
 * After we SIGTERM a pty in `endSession`, this is how long we wait for it to
 * exit on its own before escalating to SIGKILL. A claude REPL wedged on a
 * tool-permission prompt or its own internal loop can ignore SIGTERM, and
 * without escalation we'd remove the registry entry and orphan the process.
 */
const FORCE_KILL_GRACE_MS = 3_000;

const REG_KEY = "__the_manager_sessions__";
type RegistryGlobal = typeof globalThis & { [REG_KEY]?: Map<string, Session> };
function registry(): Map<string, Session> {
  const g = globalThis as RegistryGlobal;
  if (!g[REG_KEY]) g[REG_KEY] = new Map();
  return g[REG_KEY];
}

const driver = new ClaudeDriver();

function managerMcpPort(): number {
  const fromEnv = process.env.PORT ? Number(process.env.PORT) : NaN;
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return process.env.NODE_ENV === "development" ? DEV_PORT : DEFAULT_PORT;
}

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
 * every Manager spawn. Performs:
 *
 *   1. Writes / merges `.mcp.json` so Claude Code's MCP client connects to our
 *      in-process bridge (`/api/mcp`). Project-scoped MCP config lives in
 *      `.mcp.json`, NOT `.claude/settings.local.json` (the latter has a
 *      different schema and silently ignores `mcpServers`).
 *   2. Overwrites `CLAUDE.md` on every spawn — this is the operating brief
 *      Claude reads on startup, and it's system-managed so updates to the
 *      brief land in existing manager workspaces. User customisation goes in
 *      `USER_INSTRUCTION.md` / `SOUL.md` instead, both of which `CLAUDE.md`
 *      points the Manager at.
 *   3. Writes `USER_INSTRUCTION.md` and `SOUL.md` if absent (empty files).
 *      These are user-owned — never overwritten once they exist.
 *   4. Strips any stale `mcpServers` entry from `.claude/settings.local.json`
 *      that older versions of this app wrote there by mistake.
 *
 * The bridge URL points at this Next.js server's own `/api/mcp` route. Port
 * resolution mirrors `apps/desktop/main/config.ts`:
 *   - `THE_MANAGER_MCP_URL` — explicit override (full URL)
 *   - `PORT` env — set by the packaged desktop when it spawns the embedded
 *     server (production), and respected by `next start` / `next dev`
 *   - dev fallback (`NODE_ENV=development`) → 48724
 *   - prod fallback → 48723
 */
const DEV_PORT = 48724;
const DEFAULT_PORT = 48723;
async function ensureManagerWorkspace(cwd: string): Promise<void> {
  const url = process.env.THE_MANAGER_MCP_URL ?? `http://localhost:${managerMcpPort()}/api/mcp`;

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

  // 2. CLAUDE.md — system-managed brief, always rewritten so users get updates.
  await writeFile(join(cwd, "CLAUDE.md"), MANAGER_CLAUDE_MD, "utf8");

  // 3. USER_INSTRUCTION.md / SOUL.md — user-owned. Create empty if missing;
  // never overwrite.
  for (const name of ["USER_INSTRUCTION.md", "SOUL.md"]) {
    const file = join(cwd, name);
    try {
      await readFile(file, "utf8");
    } catch {
      await writeFile(file, "", "utf8");
    }
  }

  // 4. Strip the misplaced mcpServers entry from any old settings.local.json.
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
**Your default is to delegate.** Each project has its own agent with the right
cwd, tools, and context — your job is to route work to that agent, not to do
the work yourself from this cwd.

## User-owned configuration (read these on startup)

Two sibling files in this cwd are owned by the user, not the system — they
are written empty on first run and never overwritten. Read both before
acting on the first user message of a session and treat them as overrides
to anything in this file:

- **\`USER_INSTRUCTION.md\`** — the user's standing instructions for how
  you should behave (delegation preferences, tone, workflows, projects to
  favour, etc.). If a directive here conflicts with this brief, the user
  wins.
- **\`SOUL.md\`** — the user's description of your personality / voice /
  values. Adopt it. If empty, use the default neutral, concise tone.

If either file is empty, just proceed with the defaults below.

## Tools you have here

The MCP server **\`the-manager\`** is wired up via \`.mcp.json\` in this cwd.

- **\`list_projects()\`** — every project the user has registered. Each entry
  is \`{ id, name, path, defaultDriver, ephemeral, expiresAt }\`. \`ephemeral:
  true\` rows are scratch projects you created via \`propose_project\` — they
  auto-destroy on 24h TTL or when this Manager session is restarted.
- **\`get_project_status(id)\`** — \`{ alive, lastActivityAt }\`. \`alive: true\`
  means a claude session is already running for that project (usually because
  the user has its terminal open).
- **\`send_to_project(id, text)\`** — types \`text\` into the project's
  interactive terminal as the user. **Auto-spawns** the project's claude
  session if it isn't running yet — you don't need the user to open the
  project tab first. This is how you delegate.
  - If the session was **already alive**, Enter is appended automatically
    and the prompt is submitted (returns \`"sent"\`).
  - If this call had to **cold-spawn** the session, the text is typed but
    Enter is **not** pressed — the prompt sits in the user's input box for
    them to review and submit (returns \`"spawned"\`). In that case, do not
    call \`read_project_terminal\` waiting for a reply; the user hasn't
    submitted yet. Tell them the prompt is queued in the project's terminal
    and they can press Enter when ready.
- **\`read_project_terminal(id, lines?)\`** — tail of the project agent's pty
  output. Use this to see the agent's response before following up. Returns
  an error if no session exists yet (call \`send_to_project\` first to spawn
  one).
- **\`propose_project({ name?, path?, defaultDriver?, ephemeral?, reason? })\`**
  — **ask the user to register a project**. The UI opens its project-creation
  dialog with your prefill and a banner showing \`reason\`. The user can edit
  any field (including swapping the folder via the picker) and confirms or
  cancels. **This call BLOCKS until they decide** (5-minute timeout). Returns
  \`{ kind: "confirmed", project: { id, name, path, defaultDriver, ephemeral, expiresAt } }\`
  or \`{ kind: "cancelled" }\`. Use it for all three creation flows:
  - **Adding an existing project**: prefill \`name\` + \`path\` you inferred
    from the user's message; leave \`ephemeral\` off.
  - **Creating a brand-new project**: prefill what you can; the user picks
    the real folder.
  - **Creating a temp/scratch project for a long task**: pass
    \`ephemeral: true\`. Omit \`path\` and the dialog opens on a fresh
    \`~/.the-manager/temp/<uuid>/\` directory that's created on confirm.
  Always include a one-sentence \`reason\` — the user sees it and uses it
  to decide whether to confirm.
- **\`destroy_temp_project({ id })\`** — tear down an ephemeral project you
  created earlier. Kills its session, removes the registration, and deletes
  the on-disk directory if it lives under \`~/.the-manager/temp/\`. Errors if
  the project isn't ephemeral. Call this when your long task is done so the
  temp project doesn't linger. (The Manager-restart sweep and 24h TTL will
  catch it eventually, but explicit cleanup is preferable.)

**Important about \`propose_project\`:** until the user confirms, the project
does NOT exist. Don't pretend it does, don't \`send_to_project\` with the
prefilled id, and don't claim success in your reply. If \`cancelled\`, tell
the user the request was cancelled and ask what to do next.

## Default workflow: delegate to the active project

For **every** non-trivial user message, run this loop before answering yourself:

1. **Call \`list_projects\`** to see what's registered.
2. **Pick the target project.** Call \`get_project_status\` on candidates and
   prefer one with \`alive: true\` (those are the projects the user has
   already opened, so a session exists and they're likely focused there). If
   several are alive, choose the most recent \`lastActivityAt\`. If none are
   alive, choose the project whose name/path best matches the user's
   request — \`send_to_project\` will auto-spawn its claude session. If two
   projects match equally well, ask the user one short question instead of
   guessing.
3. **Decide: delegate or handle here?** (See "When to answer directly" below.
   Default: delegate.)
4. **Pick a slash command if one fits.** Project agents run \`claude\` and
   expose slash commands + skills (see "Prefer slash commands" below). List
   what's available before composing a free-form prompt.
5. **Refine the prompt.** Don't echo the user's raw text — turn it into a
   clear, complete instruction the project agent can act on (see
   "Interpreting short commands"). If you picked a slash command in step 4,
   send \`/<command> <args>\` instead of natural language.
6. **\`send_to_project(targetId, refinedPrompt)\`.** This auto-spawns the
   session if needed; the user will see the conversation when they open the
   project's tab.
7. **Wait briefly, then \`read_project_terminal(targetId)\`** to confirm the
   agent picked it up. Surface its reply back to the user.

If no project is registered at all, or the user's request doesn't fit any
registered project, you can **propose creating one** yourself via
\`propose_project\` — pre-fill what you can infer from the user's message
(name, suggested path, ephemeral if it's clearly a one-off task) and let the
user confirm. Don't insist on creation if listing existing projects + asking
one short question would do.

## Prefer slash commands and skills over free-form prompts

The project agent is a Claude Code REPL. It has **slash commands** (e.g.
\`/review\`, \`/sc:implement\`, \`/security-review\`, \`/test\`, \`/git\`) and
**skills** (e.g. \`webapp-testing\`, \`frontend-design\`, \`doc-coauthoring\`)
that are purpose-built for common tasks. A targeted slash command almost
always beats a long natural-language prompt: it runs a curated workflow with
the right tools, persona, and output format.

**Always list available commands first when the user's request maps to a
common workflow** (review, test, build, deploy, refactor, document, debug,
implement a feature, security scan, git operations, etc.). Two ways to list:

- Ask the project agent: \`send_to_project(id, "/help")\` then
  \`read_project_terminal(id)\` to see its installed commands.
- For skills, the agent's startup context lists them; send \`"what skills do
  you have available?"\` if you need to enumerate.

**Selection rules**:

1. **Exact match** — if a command's name/description matches the user's
   intent (e.g. user says "review my PR" → \`/review\` or \`/code-review\`),
   send \`/<command> <minimal args>\` verbatim. Don't wrap it in prose.
2. **Skill match** — if a skill's trigger description fits (e.g. user says
   "test the login page in a browser" → \`webapp-testing\` skill), prompt
   the agent in a way that triggers it: \`"use the webapp-testing skill to
   verify the login flow"\`.
3. **No match** — fall back to a refined natural-language prompt.
4. **Ambiguous** — if two commands could fit, ask the user one short
   clarifying question naming both options, rather than guessing.

**Don't invent commands.** Only send slash commands you've confirmed exist
via \`/help\` or the agent's skill list. If you're unsure, list first, then
send.

## Interpreting short commands

User messages to the Manager are often terse ("30 cup", "research mongo 8
breaking changes", "fix the failing test"). Before delegating:

- **Read the active project's context.** Its name and recent terminal output
  usually disambiguate the request. "30 cup" in a project called *MongoDB 8
  POC* with recent migration discussion almost certainly isn't a unit
  conversion — it's a typo or shorthand. Ask the user; do not invent an
  answer.
- **Pick the single best interpretation.** If two are plausible, ask one
  short clarifying question instead of forwarding ambiguity.
- **Expand before sending.** Rewrite "research mongo 8 breaking changes"
  into a complete prompt: project context + concrete task + expected output
  format. The project agent should not have to guess what you meant.
- **Never invent project content.** Don't research, summarize, or analyze
  project material yourself and pass it on — let the project agent do that
  with its own tools and cwd.

## When to answer directly (don't delegate)

Only handle these in-cwd:

- **Orchestration meta**: "what projects are registered?", "which is active?",
  "is project X running?" — answer from \`list_projects\` /
  \`get_project_status\`.
- **Explicit Manager-scope requests**: "Manager, jot this note", "draft a
  message for me here" — anything the user clearly wants done in your
  workspace, not inside a project.
- **No live project and no project locus**: a pure question with no relevant
  project to delegate to. Even then, prefer asking which project it belongs
  in over answering blindly.

Anything that touches code, files, or knowledge inside a project → delegate.

## Operating principles

- **Coordinate, don't duplicate.** Don't open or edit project files from this
  cwd; the project agent has the right tools and context.
- **Alive = already-open.** \`alive: true\` means the project's claude
  session is already running; treat it as a focus hint, not a precondition.
  You can delegate to any registered project — \`send_to_project\` will
  spawn the session if it's not alive yet.
- **Read before re-sending.** After dispatching non-trivial work, call
  \`read_project_terminal\` before sending a follow-up.
- **The terminal is visible to the user.** Whatever you \`send_to_project\`
  is displayed in their UI; don't echo secrets.

## Your own workspace

This cwd (\`~/.the-manager/manager/cwd\`) is your private scratch space — fine
for notes and intermediate files tied to orchestration. Project work goes
through the project agents.
`;

function scheduleIdleCheck(session: Session, projectId: ProjectId): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    session.idleTimer = null;
    if (session.exited) return;
    if (session.state !== "working") return;
    session.state = "idle";
    session.readyAt = new Date().toISOString();
    emitNotification({
      projectId,
      kind: "ready",
      severity: "info",
      message: "is ready for input",
    });
  }, IDLE_QUIET_MS);
}

/**
 * Heuristic: does the recent pty output look like Claude is showing a
 * permission / confirmation prompt? We scan a small tail of the recording for
 * a handful of known marker phrases. This is intentionally conservative —
 * better to miss a prompt than to fire spurious urgent notifications. Swap in
 * structured detection if claude exposes one.
 */
const PROMPT_MARKERS: readonly string[] = [
  "Do you want to proceed?",
  "Do you want to make this edit",
  "Do you want to allow",
  "❯ 1. Yes",
  "❯ 1) Yes",
  "[y/n]",
  "(y/n)",
];
const PROMPT_TAIL_BYTES = 2_048;

function recordingTail(session: Session, bytes: number): string {
  let total = 0;
  const chunks: string[] = [];
  for (let i = session.recording.length - 1; i >= 0 && total < bytes; i--) {
    const c = session.recording[i];
    if (!c) continue;
    chunks.unshift(c);
    total += c.length;
  }
  return chunks.join("");
}

function looksLikePrompt(session: Session): boolean {
  const tail = recordingTail(session, PROMPT_TAIL_BYTES);
  for (const marker of PROMPT_MARKERS) {
    if (tail.includes(marker)) return true;
  }
  return false;
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
    state: "idle",
    readyAt: null,
    idleTimer: null,
  };

  handle.on("data", ({ chunk }) => {
    appendChunk(session, chunk);
    session.lastActivityAt = new Date().toISOString();
    for (const sub of session.dataSubs) sub(chunk);
    if (session.state === "working") {
      // Permission prompt mid-flow → flip to needs_input and fire urgent.
      // The idle timer is left to expire harmlessly; the next user keystroke
      // bounces back to "working".
      if (looksLikePrompt(session)) {
        session.state = "needs_input";
        if (session.idleTimer) {
          clearTimeout(session.idleTimer);
          session.idleTimer = null;
        }
        emitNotification({
          projectId,
          kind: "needs_input",
          severity: "urgent",
          message: "is waiting on your approval",
        });
      } else {
        scheduleIdleCheck(session, projectId);
      }
    }
  });

  handle.on("exit", () => {
    session.exited = true;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    emitNotification({
      projectId,
      kind: "exited",
      severity: "attention",
      message: "session exited",
    });
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
  // If we'd flagged needs_input (permission prompt), any keystroke the user
  // sends is them responding to it — clear the flag back to working so a
  // single-key answer ("y", "1") doesn't leave the urgent notification armed.
  if (s.state === "needs_input") {
    s.state = "working";
    scheduleIdleCheck(s, projectId);
    return true;
  }
  // Only Enter actually submits work to claude. Plain keystrokes (typing,
  // arrows, paste before Enter) shouldn't flip the agent into "working" — the
  // user is still composing.
  if (data.includes("\r") || data.includes("\n")) {
    s.state = "working";
    scheduleIdleCheck(s, projectId);
  }
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
  // SIGTERM can be ignored by a wedged agent. Escalate to SIGKILL after a
  // grace period so the pty doesn't outlive its registry entry as an orphan.
  // .unref so the timer alone won't keep the event loop alive.
  setTimeout(() => {
    try {
      s.handle.kill("SIGKILL");
    } catch {
      /* pty already exited — node-pty surfaces ESRCH when the underlying pid is gone */
    }
  }, FORCE_KILL_GRACE_MS).unref?.();
}

/**
 * Send SIGTERM to every live claude session. Invoked from runtime.ts on
 * process SIGINT / SIGTERM so the parent gives children a graceful chance to
 * exit before the Node process itself goes away.
 *
 * Pass `force: true` for a second pass after a short grace period — that
 * sends SIGKILL to whatever's still alive.
 */
export function killAllSessions(force = false): void {
  const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
  for (const s of registry().values()) {
    if (s.exited) continue;
    try {
      s.handle.kill(signal);
    } catch {
      /* already gone */
    }
  }
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
      readyAt: s.readyAt,
    };
  }
  return out;
}

/**
 * Snapshot the current recording and subscribe to live output in a single
 * synchronous step — guarantees no chunk is duplicated or missed on attach.
 * Thin wrapper around the shared `attach` helper kept for back-compat with
 * callers that import from `./sessions`.
 */
export function attach(
  session: Session,
  onData: DataSubscriber,
  onExit: ExitSubscriber,
): { initial: string[]; unsubscribe: () => void } {
  return attachRecording(session, onData, onExit);
}
