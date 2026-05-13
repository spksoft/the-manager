import "server-only";
import { paths } from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import { MANAGER_PROJECT_ID, repos } from "./runtime";

/**
 * Resolve the absolute filesystem root for any "project id" — including the
 * synthetic Manager id, which doesn't have a row in the project repo but does
 * have a dedicated cwd at `paths.managerCwd()`. Route handlers should call
 * this instead of `repos.projects.get(id).path` so the same endpoint can
 * serve both real projects and the Manager.
 */
export async function resolveProjectCwd(id: ProjectId): Promise<string> {
  if (id === MANAGER_PROJECT_ID) {
    return paths.managerCwd();
  }
  const project = await repos.projects.get(id);
  return project.path;
}
