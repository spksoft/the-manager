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
});
export type ProjectRow = z.infer<typeof ProjectSchema>;

export const ProjectsIndexSchema = z.object({
  version: z.literal(1),
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
  createdAt: z.string().datetime(),
});
export type AssetRow = z.infer<typeof AssetSchema>;

export const AssetsIndexSchema = z.object({
  version: z.literal(1),
  data: z.array(AssetSchema),
});

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
