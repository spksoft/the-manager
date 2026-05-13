"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { useEffect, useRef, useState } from "react";
import { useSessionStatuses } from "../lib/hooks";
import { MANAGER_PROJECT_ID } from "../lib/manager-id";

type JumpTarget = { type: "manager" } | { type: "project"; id: string };

interface NotificationsBellProps {
  projects: ProjectRow[];
  onJump: (target: JumpTarget) => void;
}

interface Notification {
  id: string;
  ts: string;
  projectId: string;
  /** Short user-facing text shown in the row. */
  message: string;
  /** Reserved for "needs input" later; currently always "exited". */
  kind: "exited";
}

const MAX_NOTIFICATIONS = 20;

/**
 * Header bell. Watches `useSessionStatuses` for alive → dead transitions and
 * surfaces them as toasts in a dropdown. Click a row → jump the active view
 * to that project (or to the Manager). Architected so "needs human input"
 * can be added later as another `kind`.
 */
export function NotificationsBell({ projects, onJump }: NotificationsBellProps) {
  const { data } = useSessionStatuses();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const prevAliveRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const statuses = data?.statuses ?? {};
    const prev = prevAliveRef.current;
    const next: Record<string, boolean> = {};
    const fresh: Notification[] = [];
    for (const pid of new Set([...Object.keys(prev), ...Object.keys(statuses)])) {
      const alive = statuses[pid]?.alive ?? false;
      next[pid] = alive;
      const wasAlive = prev[pid] === true;
      if (wasAlive && !alive) {
        const name =
          pid === MANAGER_PROJECT_ID
            ? "Manager"
            : (projects.find((p) => p.id === pid)?.name ?? pid.slice(0, 8));
        fresh.push({
          id: `${pid}-${Date.now()}`,
          ts: new Date().toISOString(),
          projectId: pid,
          message: `${name} session exited`,
          kind: "exited",
        });
      }
    }
    prevAliveRef.current = next;
    if (fresh.length > 0) {
      setItems((existing) => [...fresh, ...existing].slice(0, MAX_NOTIFICATIONS));
    }
  }, [data, projects]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleClick = (n: Notification) => {
    setOpen(false);
    setItems((existing) => existing.filter((x) => x.id !== n.id));
    onJump(
      n.projectId === MANAGER_PROJECT_ID
        ? { type: "manager" }
        : { type: "project", id: n.projectId },
    );
  };

  const count = items.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications (${count})`}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
        title={count > 0 ? `${count} notification${count === 1 ? "" : "s"}` : "Notifications"}
      >
        <span aria-hidden className="text-base">
          🔔
        </span>
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Notifications"
            className="animate-slide-up absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Notifications
              </span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => setItems([])}
                  className="text-[11px] text-zinc-500 hover:text-zinc-200"
                  aria-label="Clear all notifications"
                >
                  Clear all
                </button>
              )}
            </header>
            {count === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-500">Nothing right now.</div>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      role="menuitem"
                      className="flex w-full flex-col items-start gap-0.5 border-b border-zinc-900 px-3 py-2 text-left transition-colors last:border-0 hover:bg-zinc-900/60"
                    >
                      <span className="text-xs text-zinc-200">{n.message}</span>
                      <span className="text-[10px] text-zinc-500">{relativeTime(n.ts)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
