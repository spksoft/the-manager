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
  /**
   * "working" once the user has submitted (Enter) and the agent is producing
   * output; "idle" while waiting for the user. Transitions working → idle bump
   * `readyAt` so the UI can surface a "ready / needs input" notification.
   */
  state: "idle" | "working";
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

/** Cap the in-memory recording so a very chatty session doesn't grow forever. */
const MAX_RECORDING_BYTES = 1_000_000;

/**
 * How long the pty has to stay quiet after the agent was last producing output
 * before we declare it "idle / ready for input". 2s is long enough that brief
 * pauses mid-response don't fire false notifications, short enough to feel
 * responsive when the agent actually finishes.
 */
const IDLE_QUIET_MS = 2_000;

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

- **\`list_projects()\`** — every project the user has registered (id, name,
  path, defaultDriver).
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

If no project is registered at all, tell the user to register one — there's
nothing to delegate to.

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

function scheduleIdleCheck(session: Session): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    session.idleTimer = null;
    if (session.exited) return;
    if (session.state !== "working") return;
    session.state = "idle";
    session.readyAt = new Date().toISOString();
  }, IDLE_QUIET_MS);
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
    session.recording.push(chunk);
    session.recordingBytes += chunk.length;
    session.lastActivityAt = new Date().toISOString();
    while (session.recordingBytes > MAX_RECORDING_BYTES && session.recording.length > 1) {
      const dropped = session.recording.shift();
      if (dropped) session.recordingBytes -= dropped.length;
    }
    for (const sub of session.dataSubs) sub(chunk);
    if (session.state === "working") scheduleIdleCheck(session);
  });

  handle.on("exit", () => {
    session.exited = true;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
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
  // Only Enter actually submits work to claude. Plain keystrokes (typing,
  // arrows, paste before Enter) shouldn't flip the agent into "working" — the
  // user is still composing.
  if (data.includes("\r") || data.includes("\n")) {
    s.state = "working";
    scheduleIdleCheck(s);
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
