import "server-only";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * Manager-initiated action proposals that the Inbox can accept/reject inline
 * (file writes, shell runs). These differ from `manager-requests.ts`
 * proposals which need a rich modal (the project-creation dialog).
 *
 * Each proposal blocks the originating MCP tool until the UI POSTs a
 * resolution to `/api/manager/actions/[id]`. Unresolved proposals are kept
 * until the user explicitly resolves them or the wall-clock timeout fires
 * (30 minutes by default — long enough for real-world AFK reviews).
 */

export type ActionProposal =
  | {
      kind: "write_file";
      projectId: string;
      relPath: string;
      newContent: string;
      previousContent: string | null;
      reason?: string;
    }
  | {
      kind: "run_command";
      projectId: string;
      command: string;
      cwd: string;
      reason?: string;
    };

export type ActionResult = { kind: "approved" } | { kind: "rejected"; reason?: "user" | "timeout" };

export interface PendingAction {
  id: string;
  proposal: ActionProposal;
  createdAt: string;
}

interface InternalEntry extends PendingAction {
  resolve: (result: ActionResult) => void;
  timer: NodeJS.Timeout;
}

const REG_KEY = "__the_manager_actions__";
interface RegistryShape {
  pending: Map<string, InternalEntry>;
  emitter: EventEmitter;
}
type RegistryGlobal = typeof globalThis & { [REG_KEY]?: RegistryShape };

function registry(): RegistryShape {
  const g = globalThis as RegistryGlobal;
  if (!g[REG_KEY]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(64);
    g[REG_KEY] = { pending: new Map(), emitter };
  }
  return g[REG_KEY];
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export function enqueueAction(
  proposal: ActionProposal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ActionResult> {
  const reg = registry();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return new Promise<ActionResult>((resolve) => {
    const timer = setTimeout(() => {
      const entry = reg.pending.get(id);
      if (!entry) return;
      reg.pending.delete(id);
      reg.emitter.emit("resolved", { id });
      entry.resolve({ kind: "rejected", reason: "timeout" });
    }, timeoutMs);
    const entry: InternalEntry = { id, proposal, createdAt, resolve, timer };
    reg.pending.set(id, entry);
    reg.emitter.emit("enqueued", toPublic(entry));
  });
}

export function resolveAction(id: string, result: ActionResult): boolean {
  const reg = registry();
  const entry = reg.pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  reg.pending.delete(id);
  reg.emitter.emit("resolved", { id });
  entry.resolve(result);
  return true;
}

export function getPendingActions(): PendingAction[] {
  return [...registry().pending.values()].map(toPublic);
}

export function subscribeActions(handlers: {
  onEnqueued: (a: PendingAction) => void;
  onResolved: (a: { id: string }) => void;
}): () => void {
  const reg = registry();
  reg.emitter.on("enqueued", handlers.onEnqueued);
  reg.emitter.on("resolved", handlers.onResolved);
  return () => {
    reg.emitter.off("enqueued", handlers.onEnqueued);
    reg.emitter.off("resolved", handlers.onResolved);
  };
}

function toPublic(entry: InternalEntry): PendingAction {
  return { id: entry.id, proposal: entry.proposal, createdAt: entry.createdAt };
}
