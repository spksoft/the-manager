import type { AgentStatus, DriverId, ProjectId, SessionId } from "@the-manager/shared";

export interface AgentSession {
  id: SessionId;
  projectId: ProjectId;
  driver: DriverId;
  status: AgentStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}
