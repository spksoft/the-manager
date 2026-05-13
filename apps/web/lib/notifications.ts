import "server-only";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createSettingsStore } from "@the-manager/persistence";
import type {
  NotificationEvent,
  NotificationMuteEntry,
  NotificationSnapshot,
} from "./notification-types";

/**
 * In-memory notification bus. Sessions emit events here; the SSE route fans
 * them out to every connected tab. Mute state is persisted via the settings
 * store so it survives restarts; the in-memory mirror is just a fast cache
 * primed lazily on first access.
 *
 * Urgent events bypass mute by design — see `emit()` below. This is the
 * "actually needs a human" channel and shouldn't be silenceable.
 */

export type {
  NotificationEvent,
  NotificationKind,
  NotificationMuteEntry,
  NotificationSeverity,
  NotificationSnapshot,
} from "./notification-types";

interface RegistryShape {
  ring: NotificationEvent[];
  /** Mute by projectId. Lazy-loaded from settings on first access. */
  muted: Map<string, NotificationMuteEntry>;
  mutedLoaded: boolean;
  emitter: EventEmitter;
}

const REG_KEY = "__the_manager_notifications__";
type RegistryGlobal = typeof globalThis & { [REG_KEY]?: RegistryShape };

/** Bounded for the same reason as the pty recording — we only need a small
 * lookback for SSE replay on reconnect, the UI caps render at 20 anyway. */
const RING_CAP = 50;

function registry(): RegistryShape {
  const g = globalThis as RegistryGlobal;
  if (!g[REG_KEY]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(64);
    g[REG_KEY] = {
      ring: [],
      muted: new Map(),
      mutedLoaded: false,
      emitter,
    };
  }
  return g[REG_KEY];
}

const settingsStore = createSettingsStore();

async function ensureMutesLoaded(): Promise<void> {
  const reg = registry();
  if (reg.mutedLoaded) return;
  reg.mutedLoaded = true;
  try {
    const file = await settingsStore.load();
    for (const entry of file.data.notifications.mutedProjects) {
      reg.muted.set(entry.projectId, entry);
    }
  } catch {
    /* fresh install or unreadable settings — empty mute table is fine */
  }
}

function mutedExpired(entry: NotificationMuteEntry): boolean {
  if (entry.until === "forever") return false;
  return Date.parse(entry.until) <= Date.now();
}

function isMutedSync(projectId: string): boolean {
  const entry = registry().muted.get(projectId);
  if (!entry) return false;
  if (mutedExpired(entry)) {
    registry().muted.delete(projectId);
    return false;
  }
  return true;
}

/**
 * Emit a new event. Drops silently if the project is muted AND the severity
 * isn't urgent. Returns the persisted event (with id/ts) or null when dropped.
 */
export function emitNotification(
  input: Omit<NotificationEvent, "id" | "ts">,
): NotificationEvent | null {
  // Mute table may not be loaded yet on a cold process. Kick off the load but
  // don't block — first few events will ignore mute, which is fine: a fresh
  // process has no live SSE subscribers to spam anyway.
  void ensureMutesLoaded();

  if (input.severity !== "urgent" && isMutedSync(input.projectId)) {
    return null;
  }

  const event: NotificationEvent = {
    ...input,
    id: randomUUID(),
    ts: new Date().toISOString(),
  };
  const reg = registry();
  reg.ring.push(event);
  if (reg.ring.length > RING_CAP) reg.ring.splice(0, reg.ring.length - RING_CAP);
  reg.emitter.emit("event", event);
  return event;
}

/** Mark events read; broadcast so all connected tabs converge. */
export function ackNotifications(ids: string[]): void {
  const reg = registry();
  const now = new Date().toISOString();
  const acked: string[] = [];
  for (const e of reg.ring) {
    if (ids.includes(e.id) && !e.readAt) {
      e.readAt = now;
      acked.push(e.id);
    }
  }
  if (acked.length > 0) reg.emitter.emit("ack", { ids: acked });
}

/**
 * Set or clear a mute for a project. Persists to settings and broadcasts to
 * subscribers. `until = null` clears the mute.
 */
export async function setProjectMute(
  projectId: string,
  until: string | "forever" | null,
): Promise<NotificationMuteEntry | null> {
  await ensureMutesLoaded();
  const reg = registry();
  let entry: NotificationMuteEntry | null = null;
  if (until === null) {
    reg.muted.delete(projectId);
  } else {
    entry = { projectId, until };
    reg.muted.set(projectId, entry);
  }
  await settingsStore.update((current) => {
    const others = current.data.notifications.mutedProjects.filter(
      (m) => m.projectId !== projectId,
    );
    return {
      ...current,
      data: {
        ...current.data,
        notifications: {
          ...current.data.notifications,
          mutedProjects: entry ? [...others, entry] : others,
        },
      },
    };
  });
  reg.emitter.emit("mute", { projectId, entry });
  return entry;
}

/** Snapshot for SSE replay on attach. Drops expired mutes lazily. */
export async function getNotificationSnapshot(): Promise<NotificationSnapshot> {
  await ensureMutesLoaded();
  const reg = registry();
  const muted: NotificationMuteEntry[] = [];
  for (const entry of reg.muted.values()) {
    if (mutedExpired(entry)) {
      reg.muted.delete(entry.projectId);
      continue;
    }
    muted.push(entry);
  }
  return { events: [...reg.ring], muted };
}

export interface NotificationSubscribers {
  onEvent: (e: NotificationEvent) => void;
  onAck: (p: { ids: string[] }) => void;
  onMute: (p: { projectId: string; entry: NotificationMuteEntry | null }) => void;
}

export function subscribeNotifications(handlers: NotificationSubscribers): () => void {
  const reg = registry();
  reg.emitter.on("event", handlers.onEvent);
  reg.emitter.on("ack", handlers.onAck);
  reg.emitter.on("mute", handlers.onMute);
  return () => {
    reg.emitter.off("event", handlers.onEvent);
    reg.emitter.off("ack", handlers.onAck);
    reg.emitter.off("mute", handlers.onMute);
  };
}
