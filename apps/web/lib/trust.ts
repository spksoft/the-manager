import "server-only";
import { createSettingsStore } from "@the-manager/persistence";

/**
 * Per-project trust flag. When a project id is in `trustedProjects`, the
 * Manager's write/run MCP tools skip the Inbox approval and apply directly.
 * Default is empty — safe-mode is on for every project until the user opts in.
 */

let store: ReturnType<typeof createSettingsStore> | null = null;
function getStore() {
  if (!store) store = createSettingsStore();
  return store;
}

export async function isProjectTrusted(projectId: string): Promise<boolean> {
  const settings = await getStore().load();
  return settings.data.trustedProjects.includes(projectId);
}

export async function setProjectTrust(projectId: string, trusted: boolean): Promise<void> {
  await getStore().update((file) => {
    const set = new Set(file.data.trustedProjects);
    if (trusted) set.add(projectId);
    else set.delete(projectId);
    return {
      ...file,
      data: { ...file.data, trustedProjects: [...set] },
    };
  });
}

export async function listTrustedProjects(): Promise<string[]> {
  const settings = await getStore().load();
  return settings.data.trustedProjects;
}
