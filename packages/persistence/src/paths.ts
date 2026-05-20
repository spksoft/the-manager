import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root of all on-disk state for The Manager. Resolution order:
 *   1. Explicit override via `setHomeRoot(...)` (used by Electron main once it
 *      knows `app.getPath("userData")`).
 *   2. `THE_MANAGER_HOME` env var.
 *   3. `~/.the-manager/` fallback.
 */
let overrideRoot: string | null = null;

export function setHomeRoot(absPath: string): void {
  overrideRoot = absPath;
}

export function getHomeRoot(): string {
  if (overrideRoot) return overrideRoot;
  const fromEnv = process.env.THE_MANAGER_HOME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".the-manager");
}

export const paths = {
  root: () => getHomeRoot(),
  projectsIndex: () => join(getHomeRoot(), "projects.json"),
  settings: () => join(getHomeRoot(), "settings.json"),
  uiState: () => join(getHomeRoot(), "ui-state.json"),
  fileDrafts: () => join(getHomeRoot(), "file-drafts.json"),
  tasksIndex: () => join(getHomeRoot(), "tasks.json"),
  assetsRoot: () => join(getHomeRoot(), "assets"),
  assetsIndex: () => join(getHomeRoot(), "assets", "index.json"),
  assetBlob: (sha256: string) => join(getHomeRoot(), "assets", "blobs", sha256),
  projectDir: (projectId: string) => join(getHomeRoot(), "projects", projectId),
  projectMeta: (projectId: string) => join(getHomeRoot(), "projects", projectId, "meta.json"),
  sessionsIndex: (projectId: string) =>
    join(getHomeRoot(), "projects", projectId, "sessions", "index.json"),
  sessionDir: (projectId: string, sessionId: string) =>
    join(getHomeRoot(), "projects", projectId, "sessions", sessionId),
  sessionMeta: (projectId: string, sessionId: string) =>
    join(getHomeRoot(), "projects", projectId, "sessions", sessionId, "meta.json"),
  sessionTranscript: (projectId: string, sessionId: string) =>
    join(getHomeRoot(), "projects", projectId, "sessions", sessionId, "transcript.jsonl"),
  managerCwd: () => join(getHomeRoot(), "manager", "cwd"),
  /**
   * Long-term memory the Manager keeps about itself and its projects. Lives
   * under the Manager's storage root (NOT inside any project directory) so
   * uninstalling The Manager leaves no trace in user projects. Markdown by
   * convention; readable/editable by the user via the Manager's Files tab.
   */
  managerMemoryDir: () => join(getHomeRoot(), "manager", "memory"),
  managerGlobalMemoryFile: () => join(getHomeRoot(), "manager", "memory", "global.md"),
  managerProjectsMemoryDir: () => join(getHomeRoot(), "manager", "memory", "projects"),
  managerProjectMemoryFile: (projectId: string) =>
    join(getHomeRoot(), "manager", "memory", "projects", `${projectId}.md`),
  /**
   * Root for Manager-created ephemeral project directories. `destroy_temp_project`
   * only `rm -rf`s paths that live underneath this, so it can never wipe a
   * user-registered project directory.
   */
  tempProjectsRoot: () => join(getHomeRoot(), "temp"),
  tempProjectDir: (projectId: string) => join(getHomeRoot(), "temp", projectId),
};
