import "server-only";
import {
  AgentRepo,
  AssetRepo,
  ProjectRepo,
  paths,
  TaskRepo,
  TranscriptRepo,
} from "@the-manager/persistence";
import type { ProjectId } from "@the-manager/shared";
import { MANAGER_PROJECT_ID as MANAGER_PROJECT_ID_STR } from "./manager-id";

/**
 * Server-side glue around the persistence layer. The per-conversation pty
 * registry now lives in `sessions.ts`; this file just exposes the repo
 * singletons every route handler shares.
 */

export const MANAGER_PROJECT_ID = MANAGER_PROJECT_ID_STR as ProjectId;

export const repos = {
  projects: new ProjectRepo(),
  agents: new AgentRepo(),
  tasks: new TaskRepo(),
  assets: new AssetRepo(),
  transcript: new TranscriptRepo(),
};

export { paths };
