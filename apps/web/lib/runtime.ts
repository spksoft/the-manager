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
