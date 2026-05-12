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
 * Server-side glue around the persistence layer. This file used to host a
 * full per-process pty session registry; that whole subsystem is gone now
 * that chat goes through `claude -p` (see `chat.ts`). What remains is the
 * narrow set of repo singletons every route handler shares.
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
