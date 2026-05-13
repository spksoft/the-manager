import { paths } from "../paths";
import { type UiStateData, type UiStateFile, UiStateSchema } from "../schemas";
import { JsonStore } from "../store";

const defaultData: UiStateData = {
  activeView: { type: "manager" },
  activeTabByProject: {},
  activeTabManager: "agent",
};

/**
 * Single-row store for navigation state (active view + active tab per project).
 * The whole app is single-user / single-process, so there's no notion of
 * "session"; the file is one record that all browser tabs read on mount.
 */
export class UiStateRepo {
  private readonly store = new JsonStore<UiStateFile>(paths.uiState(), UiStateSchema, () => ({
    version: 1 as const,
    data: { ...defaultData, activeTabByProject: {} },
  }));

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
      };
      return { ...file, data: next };
    });
    return next;
  }

  /** Drop any tab state for a project that's being removed. */
  async forgetProject(projectId: string): Promise<void> {
    await this.store.update((file) => {
      if (!(projectId in file.data.activeTabByProject)) return file;
      const { [projectId]: _gone, ...rest } = file.data.activeTabByProject;
      const activeView =
        file.data.activeView.type === "project" && file.data.activeView.id === projectId
          ? ({ type: "manager" } as const)
          : file.data.activeView;
      return {
        ...file,
        data: { ...file.data, activeView, activeTabByProject: rest },
      };
    });
  }
}
