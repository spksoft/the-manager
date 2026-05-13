import "server-only";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ProjectRow } from "@the-manager/persistence";
import type { DriverId, ProjectId } from "@the-manager/shared";

/**
 * Request bridge: the Manager's MCP tools enqueue UI proposals here (e.g.
 * "create a project at X"), the front-end picks them up over SSE, surfaces a
 * dialog, and POSTs back the resolution. The MCP handler awaits the per-request
 * Promise so the Manager sees `{ projectId }` or `{ cancelled: true }` inline.
 *
 * Backed by `globalThis` for the same reason `sessions.ts` is — Next.js may
 * re-evaluate route modules across requests, and we need the registry to
 * outlive any single module instance.
 */

export type ProjectProposalResult =
  | { kind: "confirmed"; project: ProjectRow }
  | { kind: "cancelled"; reason?: "user" | "timeout" };

export interface ProjectProposalPayload {
  name?: string;
  path?: string;
  defaultDriver?: DriverId;
  ephemeral?: boolean;
  /** Shown to the user as a banner: "The Manager wants to create this because…". */
  reason?: string;
}

export interface PendingProjectProposal {
  id: string;
  kind: "create_project";
  payload: ProjectProposalPayload;
  createdAt: string;
}

interface InternalEntry extends PendingProjectProposal {
  resolve: (result: ProjectProposalResult) => void;
  timer: NodeJS.Timeout;
}

const REG_KEY = "__the_manager_requests__";
interface RegistryShape {
  pending: Map<string, InternalEntry>;
  emitter: EventEmitter;
}
type RegistryGlobal = typeof globalThis & { [REG_KEY]?: RegistryShape };

function registry(): RegistryShape {
  const g = globalThis as RegistryGlobal;
  if (!g[REG_KEY]) {
    const emitter = new EventEmitter();
    // SSE subscribers can stack up — keep Node from logging a warning.
    emitter.setMaxListeners(64);
    g[REG_KEY] = { pending: new Map(), emitter };
  }
  return g[REG_KEY];
}

/** Default timeout for a project proposal: 5 minutes of user attention. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Enqueue a proposal. Returns a Promise that settles when the UI calls
 * `resolveProposal` (or when the timeout fires).
 */
export function enqueueProjectProposal(
  payload: ProjectProposalPayload,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ProjectProposalResult> {
  const reg = registry();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return new Promise<ProjectProposalResult>((resolve) => {
    const timer = setTimeout(() => {
      const entry = reg.pending.get(id);
      if (!entry) return;
      reg.pending.delete(id);
      reg.emitter.emit("resolved", { id });
      entry.resolve({ kind: "cancelled", reason: "timeout" });
    }, timeoutMs);
    const entry: InternalEntry = {
      id,
      kind: "create_project",
      payload,
      createdAt,
      resolve,
      timer,
    };
    reg.pending.set(id, entry);
    reg.emitter.emit("enqueued", toPublic(entry));
  });
}

/** Called by the UI POST handler when the user confirms or cancels. */
export function resolveProposal(id: string, result: ProjectProposalResult): boolean {
  const reg = registry();
  const entry = reg.pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  reg.pending.delete(id);
  reg.emitter.emit("resolved", { id });
  entry.resolve(result);
  return true;
}

/** Snapshot of all pending proposals. Used by SSE on (re)connect. */
export function getPendingProposals(): PendingProjectProposal[] {
  return [...registry().pending.values()].map(toPublic);
}

/** Subscribe to enqueued/resolved events. Returns an unsubscribe fn. */
export function subscribeProposals(handlers: {
  onEnqueued: (p: PendingProjectProposal) => void;
  onResolved: (p: { id: string }) => void;
}): () => void {
  const reg = registry();
  reg.emitter.on("enqueued", handlers.onEnqueued);
  reg.emitter.on("resolved", handlers.onResolved);
  return () => {
    reg.emitter.off("enqueued", handlers.onEnqueued);
    reg.emitter.off("resolved", handlers.onResolved);
  };
}

function toPublic(entry: InternalEntry): PendingProjectProposal {
  return {
    id: entry.id,
    kind: entry.kind,
    payload: entry.payload,
    createdAt: entry.createdAt,
  };
}

// Re-export for callers that build a fully-typed `ProjectId` argument.
export type { ProjectId };
