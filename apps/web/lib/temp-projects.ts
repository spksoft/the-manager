import "server-only";
import { rm } from "node:fs/promises";
import { type ProjectRow, paths } from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import { refreshManagerMemoryInBackground } from "./manager-memory";
import { repos } from "./runtime";
import { endSession } from "./sessions";

/**
 * Helpers for tearing down ephemeral / temp projects. Used by:
 *   - the MCP `destroy_temp_project` tool (single project),
 *   - the Manager-restart sweep in the conversation DELETE route,
 *   - the TTL sweeper scheduled from `runtime.ts`.
 *
 * On-disk removal is only attempted when the project's path is under
 * `paths.tempProjectsRoot()`. That keeps us from `rm -rf`'ing a user-owned
 * directory even if someone manages to flip a non-temp project's
 * `ephemeral` flag.
 */

export interface DestroyResult {
  id: string;
  path: string;
  removedFromDisk: boolean;
  diskError?: string;
}

function isUnderTempRoot(p: string): boolean {
  const root = paths.tempProjectsRoot();
  if (p === root) return true;
  // Use both separators so we don't depend on the host OS — Node will produce
  // forward slashes on macOS/Linux and backslashes on Windows when paths are
  // built via path.join, but the schema can hold whatever was written.
  return p.startsWith(`${root}/`) || p.startsWith(`${root}\\`);
}

export async function destroyEphemeralProject(project: ProjectRow): Promise<DestroyResult> {
  endSession(project.id as ProjectId);
  await repos.projects.remove(project.id as ProjectId);
  const result: DestroyResult = {
    id: project.id,
    path: project.path,
    removedFromDisk: false,
  };
  if (isUnderTempRoot(project.path)) {
    try {
      await rm(project.path, { recursive: true, force: true });
      result.removedFromDisk = true;
    } catch (err) {
      result.diskError = err instanceof Error ? err.message : String(err);
    }
  }
  refreshManagerMemoryInBackground();
  return result;
}

/** Destroys every ephemeral project, regardless of TTL. */
export async function sweepEphemeralProjects(): Promise<DestroyResult[]> {
  const rows = await repos.projects.listEphemeral();
  const results: DestroyResult[] = [];
  for (const row of rows) {
    results.push(await destroyEphemeralProject(row));
  }
  return results;
}

/** Destroys ephemeral projects whose `expiresAt` has passed. */
export async function sweepExpiredEphemeralProjects(
  now: Date = new Date(),
): Promise<DestroyResult[]> {
  const rows = await repos.projects.listEphemeralExpired(now);
  const results: DestroyResult[] = [];
  for (const row of rows) {
    results.push(await destroyEphemeralProject(row));
  }
  return results;
}
