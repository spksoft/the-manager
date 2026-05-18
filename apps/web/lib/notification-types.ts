/**
 * Public types shared between the server-only notifications bus
 * (`./notifications.ts`) and the client-side bell. Kept in its own file so the
 * client can `import` from it without dragging in the server-only module.
 */

import type { NotificationMuteEntry, NotificationSeverity } from "@the-manager/persistence";

export type { NotificationMuteEntry, NotificationSeverity };

export type NotificationKind = "exited" | "ready" | "needs_input" | "manager";

export interface NotificationEvent {
  id: string;
  ts: string;
  projectId: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  message: string;
  summary?: string;
  readAt?: string;
}

export interface NotificationSnapshot {
  events: NotificationEvent[];
  muted: NotificationMuteEntry[];
}
