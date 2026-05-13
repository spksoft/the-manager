import { paths } from "../paths";
import { type UiStateData, type UiStateFile, UiStateSchema } from "../schemas";
import { JsonStore } from "../store";

const defaultData: UiStateData = {
  activeView: { type: "manager" },
  activeTabByProject: {},
  activeTabManager: "agent",
  commitMessageDraftByProject: {},
};

/**
 * Pre-parse migration: older UI state files don't have
 * `commitMessageDraftByProject`. Fill it with `{}` so the strict schema parses
 * without forcing a version bump for what is effectively an additive field.
 * Kept here (not in schemas.ts) because schemas.ts deliberately avoids
 * `.default()` — see the CLAUDE.md note on input/output type divergence.
 */
function migrate(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const file = raw as { data?: Record<string, unknown> };
  if (!file.data || typeof file.data !== "object") return raw;
  if (file.data.commitMessageDraftByProject === undefined) {
    file.data.commitMessageDraftByProject = {};
  }
  return raw;
}

/**
 * Single-row store for navigation state (active view + active tab per project).
 * The whole app is single-user / single-process, so there's no notion of
 * "session"; the file is one record that all browser tabs read on mount.
 */
export class UiStateRepo {
  private readonly store = new JsonStore<UiStateFile>(
    paths.uiState(),
    UiStateSchema,
    () => ({
      version: 1 as const,
      data: { ...defaultData, activeTabByProject: {}, commitMessageDraftByProject: {} },
    }),
    migrate,
  );

  async get(): Promise<UiStateData> {
    const file = await this.store.load();
    return file.data;
  }

  async patch(partial: Partial<UiStateData>): Promise<UiStateData> {
    let next: UiStateData = defaultData;
    await this.store.update((file) => {
      next = {
        ...file.data,
        ...partial,
        activeTabByProject: {
          ...file.data.activeTabByProject,
          ...(partial.activeTabByProject ?? {}),
        },
        commitMessageDraftByProject: {
          ...file.data.commitMessageDraftByProject,
          ...(partial.commitMessageDraftByProject ?? {}),
        },
      };
      return { ...file, data: next };
    });
    return next;
  }

  /** Drop any tab state for a project that's being removed. */
  async forgetProject(projectId: string): Promise<void> {
    await this.store.update((file) => {
      const hasTab = projectId in file.data.activeTabByProject;
      const hasDraft = projectId in file.data.commitMessageDraftByProject;
      if (!hasTab && !hasDraft) return file;
      const { [projectId]: _tab, ...restTabs } = file.data.activeTabByProject;
      const { [projectId]: _draft, ...restDrafts } = file.data.commitMessageDraftByProject;
      const activeView =
        file.data.activeView.type === "project" && file.data.activeView.id === projectId
          ? ({ type: "manager" } as const)
          : file.data.activeView;
      return {
        ...file,
        data: {
          ...file.data,
          activeView,
          activeTabByProject: restTabs,
          commitMessageDraftByProject: restDrafts,
        },
      };
    });
  }
}
