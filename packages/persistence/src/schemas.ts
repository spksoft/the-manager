import { z } from "zod";

/**
 * Zod schemas are the single source of truth for on-disk shapes. There is no
 * separate "DDL" — these schemas parse every read and stamp every write.
 */

export const DriverIdSchema = z.enum(["claude", "codex", "gemini"]);
export const AgentStatusSchema = z.enum(["starting", "running", "exited", "killed", "error"]);
export const TaskStatusSchema = z.enum(["pending", "running", "completed", "failed", "cancelled"]);

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  path: z.string().min(1),
  defaultDriver: DriverIdSchema,
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  /** Manager-created scratch projects that get auto-destroyed. */
  ephemeral: z.boolean(),
  /** Optional auto-destroy deadline (ISO). `null` = never. */
  expiresAt: z.string().datetime().nullable(),
  /**
   * Short, one-or-two-sentence summary of what the project is. Surfaced to the
   * Manager (via MCP) so it has enough context to route work without opening
   * the project. `null` means generation hasn't completed yet (or failed).
   */
  description: z.string().nullable(),
});
export type ProjectRow = z.infer<typeof ProjectSchema>;

export const ProjectsIndexSchema = z.object({
  version: z.literal(3),
  data: z.array(ProjectSchema),
});

export const SessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  driver: DriverIdSchema,
  status: AgentStatusSchema,
  pid: z.number().int().nullable(),
  cwd: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
});
export type SessionRow = z.infer<typeof SessionSchema>;

export const SessionsIndexSchema = z.object({
  version: z.literal(1),
  data: z.array(SessionSchema),
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  requestedBy: z.enum(["manager", "user"]),
  targetProjectId: z.string().uuid().nullable(),
  targetSessionId: z.string().uuid().nullable(),
  status: TaskStatusSchema,
  payload: z.string(),
  result: z.string().nullable(),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type TaskRow = z.infer<typeof TaskSchema>;

export const TasksIndexSchema = z.object({
  version: z.literal(1),
  data: z.array(TaskSchema),
});

export const AssetSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  scope: z.union([z.literal("global"), z.object({ projectId: z.string().uuid() })]),
  tags: z.array(z.string()),
  /** Path-like folder grouping. `null` means the asset lives at the root. */
  folder: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AssetRow = z.infer<typeof AssetSchema>;

export const AssetsIndexSchema = z.object({
  version: z.literal(2),
  data: z.array(AssetSchema),
  /** Folder names that exist independently of any asset (e.g. freshly created empty folders). */
  folders: z.array(z.string()),
});

export const NotificationSeveritySchema = z.enum(["info", "attention", "urgent"]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

export const NotificationMuteEntrySchema = z.object({
  projectId: z.string(),
  /** ISO timestamp, or the sentinel "forever". */
  until: z.union([z.string().datetime(), z.literal("forever")]),
});
export type NotificationMuteEntry = z.infer<typeof NotificationMuteEntrySchema>;

export const SettingsSchema = z.object({
  version: z.literal(1),
  data: z.object({
    recentProjectIds: z.array(z.string().uuid()),
    windowState: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        x: z.number().int().nullable(),
        y: z.number().int().nullable(),
        maximized: z.boolean(),
      })
      .nullable(),
    /** Free-form feature flags for in-development features. */
    flags: z.record(z.boolean()),
    network: z.object({
      // null = use the desktop's compiled-in DEFAULT_PORT (chosen the first
      // time the embedded server is started, then persisted so the URL stays
      // stable across launches). Range matches the IPv4 user/ephemeral range
      // that doesn't require elevated permissions.
      preferredPort: z.number().int().min(1024).max(65535).nullable(),
    }),
    notifications: z.object({
      /** Master switch for OS-level toasts. Bell dropdown is unaffected. */
      osToasts: z.boolean(),
      /** Lowest severity that fires an OS toast (info < attention < urgent). */
      threshold: NotificationSeveritySchema,
      /** Per-project mute table. Urgent events bypass mute by design. */
      mutedProjects: z.array(NotificationMuteEntrySchema),
    }),
  }),
});
export type SettingsFile = z.infer<typeof SettingsSchema>;

/** A single line in a session's transcript.jsonl. */
export const TranscriptLineSchema = z.object({
  ts: z.string().datetime(),
  role: z.enum(["user", "agent", "tool", "system"]),
  /** Raw payload string. Drivers may emit ANSI; the UI strips/renders as needed. */
  content: z.string(),
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

// ---------------------------------------------------------------------------
// UI state (single-user, single-process). Persisted so opening the app from a
// fresh tab restores which workspace/tab the user was in.
// ---------------------------------------------------------------------------
export const ActiveViewSchema = z.union([
  z.object({ type: z.literal("manager") }),
  z.object({ type: z.literal("project"), id: z.string().uuid() }),
  z.object({ type: z.literal("assets") }),
]);
export type ActiveView = z.infer<typeof ActiveViewSchema>;

export const ProjectTabSchema = z.enum(["agent", "files", "git", "terminal"]);
export type ProjectTab = z.infer<typeof ProjectTabSchema>;

export const ManagerTabSchema = z.enum(["agent", "files"]);
export type ManagerTab = z.infer<typeof ManagerTabSchema>;

export const TerminalDrawerSchema = z.object({
  expanded: z.boolean(),
  heightPx: z.number().int().positive(),
});
export type TerminalDrawerState = z.infer<typeof TerminalDrawerSchema>;

export const UiStateSchema = z.object({
  version: z.literal(1),
  data: z.object({
    activeView: ActiveViewSchema,
    activeTabByProject: z.record(ProjectTabSchema),
    activeTabManager: ManagerTabSchema,
    // Per-project draft of the next commit message. Survives reloads so the
    // user doesn't lose a half-typed message (or a Claude-generated draft).
    commitMessageDraftByProject: z.record(z.string()),
    terminalDrawer: TerminalDrawerSchema,
  }),
});
export type UiStateFile = z.infer<typeof UiStateSchema>;
export type UiStateData = UiStateFile["data"];

// ---------------------------------------------------------------------------
// File editor drafts. Keyed by `${projectId}:${path}`; cleared on save.
// `baseMtime` is the on-disk mtime the draft was written against — used to
// discard the draft when the file changes underneath us.
// ---------------------------------------------------------------------------
export const FileDraftSchema = z.object({
  content: z.string(),
  baseMtime: z.string(),
  updatedAt: z.string().datetime(),
});
export type FileDraftRow = z.infer<typeof FileDraftSchema>;

export const FileDraftsSchema = z.object({
  version: z.literal(1),
  drafts: z.record(FileDraftSchema),
});
export type FileDraftsFile = z.infer<typeof FileDraftsSchema>;
