import type { ProjectId, SessionId, TaskId, TaskStatus } from "@the-manager/shared";

export interface Task {
  id: TaskId;
  /** "manager" when dispatched by the Manager agent; "user" when issued directly. */
  requestedBy: "manager" | "user";
  targetProjectId: ProjectId | null;
  targetSessionId: SessionId | null;
  status: TaskStatus;
  /** Free-form payload — the prompt or command for the agent. */
  payload: string;
  result: string | null;
  createdAt: string;
  finishedAt: string | null;
}
