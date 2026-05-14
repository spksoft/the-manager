import { paths } from "../paths";
import { type UiStateData, type UiStateFile, UiStateSchema } from "../schemas";
import { JsonStore } from "../store";

/**
 * Patch shape: top-level fields are optional, and the `terminalDrawer` sub-object
 * can also be partial so callers can flip `expanded` without resending `heightPx`.
 * Record-valued fields (`activeTabByProject`, `commitMessageDraftByProject`) keep
 * their normal `Record<string, V>` shape and merge per-key.
 */
export type UiStatePatch = Partial<Omit<UiStateData, "terminalDrawer">> & {
  terminalDrawer?: Partial<UiStateData["terminalDrawer"]>;
};

const defaultData: UiStateData = {
  activeView: { type: "manager" },
  activeTabByProject: {},
  activeTabManager: "agent",
  commitMessageDraftByProject: {},
  terminalDrawer: { expanded: false, heightPx: 280 },
};

/**
 * Pre-parse migration: older UI state files lack newer additive fields, or
 * carry enum values from tabs/views that have since been removed (e.g. an
 * older build's "tasks" Manager tab). Coerce them to current defaults so the
 * strict schema parses without forcing a version bump — otherwise the whole
 * UI gets wedged: GET /api/ui-state 400s, useUiState().data stays undefined,
 * and every tab/drawer click PUTs against the same broken file and 400s too.
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
  if (file.data.terminalDrawer === undefined) {
    file.data.terminalDrawer = { expanded: false, heightPx: 280 };
  }
  if (file.data.activeTabManager !== "agent" && file.data.activeTabManager !== "files") {
    file.data.activeTabManager = "agent";
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
      data: {
        ...defaultData,
        activeTabByProject: {},
        commitMessageDraftByProject: {},
        terminalDrawer: { expanded: false, heightPx: 280 },
      },
    }),
    migrate,
  );

  async get(): Promise<UiStateData> {
    const file = await this.store.load();
    return file.data;
  }

  async patch(partial: UiStatePatch): Promise<UiStateData> {
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
        terminalDrawer: {
          ...file.data.terminalDrawer,
          ...(partial.terminalDrawer ?? {}),
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
