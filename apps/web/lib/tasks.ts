import "server-only";
import { EventEmitter } from "node:events";
import { paths, type TaskRow } from "@the-manager/persistence";
import { newId, type ProjectId, type TaskId, type TaskStatus } from "@the-manager/shared";
import { appendJournal } from "./manager-memory";
import { repos } from "./runtime";

/**
 * Task lifecycle for Manager-initiated work. Backed by `repos.tasks` (the
 * existing `tasks.json` JsonStore) and fanned out to UI listeners over SSE.
 *
 * Manager creates a task whenever it dispatches a unit of work (e.g.
 * `send_to_project`, fan_out). The task starts in `running`; Manager calls
 * `complete_task` (with a summary) to mark it done, at which point the
 * summary is appended to today's journal entry.
 */

interface TaskCreateInput {
  requestedBy: TaskRow["requestedBy"];
  targetProjectId: ProjectId | null;
  targetSessionId: string | null;
  payload: string;
  /** Optional initial status. Defaults to "running" so the UI sees activity immediately. */
  initialStatus?: TaskStatus;
}

interface TaskCompleteInput {
  taskId: TaskId;
  status: Exclude<TaskStatus, "pending" | "running">;
  result?: string;
  /** Manager-supplied human-readable title for the journal entry. */
  journalTitle?: string;
}

const EM_KEY = "__the_manager_tasks_emitter__";
type EmitterGlobal = typeof globalThis & { [EM_KEY]?: EventEmitter };
function tasksEmitter(): EventEmitter {
  const g = globalThis as EmitterGlobal;
  if (!g[EM_KEY]) {
    const em = new EventEmitter();
    em.setMaxListeners(64);
    g[EM_KEY] = em;
  }
  return g[EM_KEY];
}

export async function createTask(input: TaskCreateInput): Promise<TaskRow> {
  const id = newId.task();
  const row: TaskRow = {
    id,
    requestedBy: input.requestedBy,
    targetProjectId: input.targetProjectId,
    targetSessionId: input.targetSessionId,
    status: input.initialStatus ?? "running",
    payload: input.payload,
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  await repos.tasks.upsert(row);
  tasksEmitter().emit("update", row);
  return row;
}

export async function completeTask(input: TaskCompleteInput): Promise<TaskRow | null> {
  const before = await repos.tasks.get(input.taskId).catch(() => null);
  if (!before) return null;
  const finishedAt = new Date().toISOString();
  const next: TaskRow = {
    ...before,
    status: input.status,
    result: input.result ?? null,
    finishedAt,
  };
  await repos.tasks.upsert(next);
  tasksEmitter().emit("update", next);

  // Journal entry on success only — failed/cancelled tasks stay in the task
  // log without polluting the daily summary.
  if (input.status === "completed") {
    void appendJournal(paths.managerCwd(), {
      taskId: next.id,
      title: input.journalTitle ?? truncateForTitle(next.payload),
      bodyMd: input.result?.trim() ?? "_(no summary)_",
      finishedAt,
    }).catch((err) => console.error("[tasks] journal append failed:", err));
  }
  return next;
}

export async function listTasks(): Promise<TaskRow[]> {
  const rows = await repos.tasks.list();
  return rows.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function subscribeTasks(handler: (row: TaskRow) => void): () => void {
  const em = tasksEmitter();
  em.on("update", handler);
  return () => em.off("update", handler);
}

function truncateForTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed || "(empty task)";
}
