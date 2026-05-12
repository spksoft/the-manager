import type { DriverId, ProjectId } from "@the-manager/shared";

export interface Project {
  id: ProjectId;
  name: string;
  /** Absolute path on disk. The agent's cwd defaults to this. */
  path: string;
  /** Which CLI agent this project uses by default. */
  defaultDriver: DriverId;
  createdAt: string;
  lastUsedAt: string | null;
}
