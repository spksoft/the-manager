import { randomUUID } from "node:crypto";

export type ProjectId = string & { readonly __brand: "ProjectId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type TaskId = string & { readonly __brand: "TaskId" };
export type AssetId = string & { readonly __brand: "AssetId" };

export const newId = {
  project: (): ProjectId => randomUUID() as ProjectId,
  session: (): SessionId => randomUUID() as SessionId,
  task: (): TaskId => randomUUID() as TaskId,
  asset: (): AssetId => randomUUID() as AssetId,
};
