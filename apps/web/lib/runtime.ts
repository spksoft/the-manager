import "server-only";
import {
  AgentRepo,
  AssetRepo,
  FileDraftRepo,
  ProjectRepo,
  paths,
  TaskRepo,
  TranscriptRepo,
  UiStateRepo,
} from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import { MANAGER_PROJECT_ID as MANAGER_PROJECT_ID_STR } from "./manager-id";

/**
 * Server-side glue around the persistence layer. The per-conversation pty
 * registry now lives in `sessions.ts`; this file just exposes the repo
 * singletons every route handler shares.
 */

export const MANAGER_PROJECT_ID = MANAGER_PROJECT_ID_STR as ProjectId;

export const repos = {
  projects: new ProjectRepo(),
  agents: new AgentRepo(),
  tasks: new TaskRepo(),
  assets: new AssetRepo(),
  transcript: new TranscriptRepo(),
  uiState: new UiStateRepo(),
  fileDrafts: new FileDraftRepo(),
};

export { paths };

// ---------------------------------------------------------------------------
// Ephemeral project TTL sweeper.
// ---------------------------------------------------------------------------
// Runs once at startup (catches anything that expired while the app was off)
// and then on a fixed cadence. Guarded by a globalThis flag so Next.js's
// per-request module re-evaluation can't accidentally schedule a second
// interval and double up on work.

const TTL_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TTL_FLAG_KEY = "__the_manager_ttl_sweeper__";
type TtlGlobal = typeof globalThis & { [TTL_FLAG_KEY]?: true };

function ensureTtlSweeper(): void {
  const g = globalThis as TtlGlobal;
  if (g[TTL_FLAG_KEY]) return;
  g[TTL_FLAG_KEY] = true;

  const sweep = async () => {
    // Lazy import: runtime.ts is evaluated very early (every route imports
    // `repos`), and temp-projects.ts pulls in sessions.ts which has
    // server-only side effects we don't need at module-load time.
    try {
      const { sweepExpiredEphemeralProjects } = await import("./temp-projects");
      await sweepExpiredEphemeralProjects();
    } catch (err) {
      console.error("[temp-projects] TTL sweep failed:", err);
    }
  };

  // Initial run on a microtask so we don't block module evaluation.
  void Promise.resolve().then(sweep);
  setInterval(sweep, TTL_SWEEP_INTERVAL_MS).unref?.();
}

ensureTtlSweeper();

// ---------------------------------------------------------------------------
// Graceful shutdown — kill live pty sessions on SIGINT / SIGTERM.
// ---------------------------------------------------------------------------
// Default Node behaviour on these signals is immediate exit; the kernel then
// usually delivers SIGHUP to descendant ptys via the controlling session,
// which is enough in practice. We register explicit handlers so we can:
//   1. SIGTERM every live claude / shell pty first (so they emit "exited"
//      notifications and clean up their own state),
//   2. wait a brief grace period,
//   3. SIGKILL anything that ignored SIGTERM (a wedged claude REPL is the
//      typical culprit),
//   4. then exit ourselves with the conventional 128 + signum code.
//
// Guarded by a globalThis flag so Next's per-request module re-evaluation
// can't pile up duplicate listeners. We use `process.once` (not `process.on`)
// so a second Ctrl+C falls back to default behaviour and the user always has
// an escape hatch if our cleanup hangs.

const SHUTDOWN_FLAG = "__the_manager_shutdown__";
type ShutdownGlobal = typeof globalThis & { [SHUTDOWN_FLAG]?: true };
const SHUTDOWN_GRACE_MS = 300;

function ensureShutdownHandlers(): void {
  const g = globalThis as ShutdownGlobal;
  if (g[SHUTDOWN_FLAG]) return;
  g[SHUTDOWN_FLAG] = true;

  const onSignal = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    try {
      // Dynamic imports for the same reason the TTL sweeper uses them:
      // runtime.ts is loaded extremely early and we don't want to drag in
      // sessions.ts's side effects at module-load time.
      const [{ killAllSessions }, { killAllTerminals }] = await Promise.all([
        import("./sessions"),
        import("./terminals"),
      ]);
      killAllSessions();
      killAllTerminals();
      await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
      killAllSessions(true);
      killAllTerminals(true);
    } catch (err) {
      console.error("[the-manager] shutdown cleanup failed:", err);
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.once("SIGINT", () => void onSignal("SIGINT"));
  process.once("SIGTERM", () => void onSignal("SIGTERM"));
}

ensureShutdownHandlers();
