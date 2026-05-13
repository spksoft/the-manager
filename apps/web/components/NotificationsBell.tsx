"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNotifications, useSettings, useUiState } from "../lib/hooks";
import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import type { NotificationEvent } from "../lib/notification-types";

type JumpTarget = { type: "manager" } | { type: "project"; id: string };

interface NotificationsBellProps {
  projects: ProjectRow[];
  onJump: (target: JumpTarget) => void;
}

interface ProjectGroup {
  projectId: string;
  name: string;
  events: NotificationEvent[];
  unreadCount: number;
  /** Highest severity among unread events; falls back to most recent if all read. */
  highlight: NotificationEvent;
}

/**
 * Header bell. Subscribes to the server-side notification bus via SSE, groups
 * events by project, surfaces unread counts, and routes the user to the right
 * surface on click. Fires Web Notifications (OS toasts) only when the user is
 * not already looking at that project — suppression uses `useUiState` plus the
 * document visibility state. Urgent events (`needs_input`) always sound.
 */
export function NotificationsBell({ projects, onJump }: NotificationsBellProps) {
  const { events, muted, unreadCount, ack, mute, unmute, clear, hydrated } = useNotifications();
  const { data: settings } = useSettings();
  const { data: uiState } = useUiState();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Request OS notification permission once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {
        /* user dismissed — degrade to bell-only */
      });
    }
  }, []);

  // Resolve project names. The Manager has a known fixed id.
  const nameFor = useMemo(() => {
    const lookup = new Map(projects.map((p) => [p.id, p.name]));
    return (pid: string) =>
      pid === MANAGER_PROJECT_ID ? "Manager" : (lookup.get(pid) ?? pid.slice(0, 8));
  }, [projects]);

  // Group events by projectId; sort groups by most-recent event ts.
  const groups: ProjectGroup[] = useMemo(() => {
    const byProject = new Map<string, NotificationEvent[]>();
    for (const e of events) {
      const arr = byProject.get(e.projectId) ?? [];
      arr.push(e);
      byProject.set(e.projectId, arr);
    }
    const out: ProjectGroup[] = [];
    for (const [pid, evs] of byProject) {
      const unread = evs.filter((e) => !e.readAt);
      const highlight = pickHighlight(unread.length > 0 ? unread : evs);
      if (!highlight) continue;
      out.push({
        projectId: pid,
        name: nameFor(pid),
        events: evs,
        unreadCount: unread.length,
        highlight,
      });
    }
    out.sort((a, b) => Date.parse(b.events[0]?.ts ?? "") - Date.parse(a.events[0]?.ts ?? ""));
    return out;
  }, [events, nameFor]);

  // Fire OS toasts for newly-arrived events. The deduped `events` array is
  // newest-first; we track the most recent id we've already handled and only
  // toast anything that arrived after it.
  const lastToastedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (events.length === 0) return;
    const newestId = events[0]?.id;
    if (!newestId) return;
    const cutoff = lastToastedIdRef.current;
    lastToastedIdRef.current = newestId;
    if (cutoff === null) return; // first paint after hydration: don't replay history
    const fresh: NotificationEvent[] = [];
    for (const e of events) {
      if (e.id === cutoff) break;
      fresh.push(e);
    }
    fireToasts(fresh, {
      activeView: uiState?.activeView,
      osToasts: settings?.data.notifications.osToasts ?? true,
      threshold: settings?.data.notifications.threshold ?? "info",
      nameFor,
      onClick: (target) => {
        onJump(target);
        try {
          window.focus();
        } catch {
          /* ignore */
        }
      },
    });
  }, [events, hydrated, uiState?.activeView, settings, onJump, nameFor]);

  // Ack everything visible after the dropdown stays open briefly.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const unreadIds = events.filter((e) => !e.readAt).map((e) => e.id);
      if (unreadIds.length > 0) ack(unreadIds);
    }, 600);
    return () => clearTimeout(t);
  }, [open, events, ack]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleJump = (projectId: string) => {
    setOpen(false);
    onJump(
      projectId === MANAGER_PROJECT_ID ? { type: "manager" } : { type: "project", id: projectId },
    );
  };

  const toggleGroup = (projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const hasUrgent = events.some((e) => !e.readAt && e.severity === "urgent");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications (${unreadCount})`}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
        title={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "Notifications"
        }
      >
        <span aria-hidden className="text-base">
          🔔
        </span>
        {unreadCount > 0 && (
          <span
            aria-hidden
            className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
              hasUrgent ? "bg-red-500" : "bg-amber-500"
            }`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Notifications"
            className="animate-slide-up absolute right-0 z-40 mt-2 w-96 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Notifications
              </span>
              {events.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const ids = events.filter((e) => !e.readAt).map((e) => e.id);
                      if (ids.length > 0) ack(ids);
                    }}
                    className="text-[11px] text-zinc-500 hover:text-zinc-200"
                    aria-label="Mark all as read"
                  >
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={() => clear()}
                    className="text-[11px] text-zinc-500 hover:text-zinc-200"
                    aria-label="Clear all notifications"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </header>
            {groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-500">
                You'll be pinged when an agent finishes or asks for approval.
              </div>
            ) : (
              <ul className="max-h-[28rem] overflow-y-auto">
                {groups.map((g) => {
                  const isMuted = !!muted[g.projectId];
                  const isOpen = expanded.has(g.projectId);
                  return (
                    <li key={g.projectId} className="border-b border-zinc-900 last:border-0">
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.projectId)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-900/60"
                      >
                        <SeverityDot severity={g.highlight.severity} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-medium text-zinc-100">
                              {g.name}
                            </span>
                            {isMuted && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">
                                muted
                              </span>
                            )}
                            {g.unreadCount > 0 && (
                              <span className="text-[10px] text-zinc-500">{g.unreadCount} new</span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-zinc-400">
                            {g.highlight.message} · {relativeTime(g.highlight.ts)}
                          </div>
                        </div>
                        <span
                          aria-hidden
                          className={`text-zinc-600 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        >
                          ›
                        </span>
                      </button>
                      {isOpen && (
                        <div className="bg-zinc-950/60 px-3 pb-2">
                          <ul className="space-y-1">
                            {g.events.map((e) => (
                              <li
                                key={e.id}
                                className="flex items-start gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-zinc-900/60"
                              >
                                <SeverityDot severity={e.severity} />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-zinc-200">{e.message}</div>
                                  {e.summary && (
                                    <div className="truncate text-[10px] text-zinc-500">
                                      {e.summary}
                                    </div>
                                  )}
                                  <div className="text-[10px] text-zinc-600">
                                    {relativeTime(e.ts)}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleJump(g.projectId)}
                                  className="text-[10px] text-zinc-400 hover:text-zinc-100"
                                  aria-label={`Jump to ${g.name}`}
                                >
                                  Jump
                                </button>
                                <button
                                  type="button"
                                  onClick={() => clear([e.id])}
                                  className="text-zinc-600 hover:text-zinc-200"
                                  aria-label="Dismiss notification"
                                  title="Dismiss"
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 flex items-center gap-3 border-t border-zinc-900 pt-2 text-[10px] text-zinc-500">
                            <button
                              type="button"
                              onClick={() => handleJump(g.projectId)}
                              className="hover:text-zinc-100"
                            >
                              Open project
                            </button>
                            <span className="text-zinc-700">·</span>
                            <button
                              type="button"
                              onClick={() => clear(g.events.map((e) => e.id))}
                              className="hover:text-zinc-100"
                            >
                              Clear
                            </button>
                            <span className="text-zinc-700">·</span>
                            {isMuted ? (
                              <button
                                type="button"
                                onClick={() => unmute(g.projectId)}
                                className="hover:text-zinc-100"
                              >
                                Unmute
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => mute(g.projectId, "1h")}
                                  className="hover:text-zinc-100"
                                >
                                  Mute 1h
                                </button>
                                <button
                                  type="button"
                                  onClick={() => mute(g.projectId, "forever")}
                                  className="hover:text-zinc-100"
                                >
                                  Mute forever
                                </button>
                              </>
                            )}
                          </div>
                          {isMuted && (
                            <div className="mt-1 text-[10px] text-zinc-600">
                              Urgent events (approval prompts) will still notify.
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SeverityDot({ severity }: { severity: NotificationEvent["severity"] }) {
  const tone =
    severity === "urgent"
      ? "bg-red-500"
      : severity === "attention"
        ? "bg-amber-500"
        : "bg-zinc-500";
  return <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone}`} />;
}

function pickHighlight(events: NotificationEvent[]): NotificationEvent | undefined {
  // Severity rank — urgent first. Within the same severity, newest wins.
  const rank: Record<NotificationEvent["severity"], number> = {
    urgent: 3,
    attention: 2,
    info: 1,
  };
  return [...events].sort((a, b) => {
    const dr = rank[b.severity] - rank[a.severity];
    if (dr !== 0) return dr;
    return Date.parse(b.ts) - Date.parse(a.ts);
  })[0];
}

interface ToastOpts {
  activeView: { type: string; id?: string } | undefined;
  osToasts: boolean;
  threshold: NotificationEvent["severity"];
  nameFor: (projectId: string) => string;
  onClick: (target: JumpTarget) => void;
}

function fireToasts(events: NotificationEvent[], opts: ToastOpts): void {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!opts.osToasts) return;

  const rank: Record<NotificationEvent["severity"], number> = {
    info: 1,
    attention: 2,
    urgent: 3,
  };
  const minRank = rank[opts.threshold];

  for (const e of events) {
    if (rank[e.severity] < minRank) continue;
    // Suppress toast if user is already focused on this project's view.
    if (isFocusedOn(e.projectId, opts.activeView)) continue;
    try {
      const name = opts.nameFor(e.projectId);
      const n = new Notification("The Manager", {
        body: `${name} ${e.message}${e.summary ? ` — ${e.summary}` : ""}`,
        tag: e.id,
        // Urgent prompts deserve the OS's attention sound; the others stay
        // silent so a busy session doesn't beep every couple of seconds.
        silent: e.severity !== "urgent",
      });
      n.onclick = () => {
        opts.onClick(
          e.projectId === MANAGER_PROJECT_ID
            ? { type: "manager" }
            : { type: "project", id: e.projectId },
        );
        n.close();
      };
    } catch {
      /* some platforms throw on construction — degrade silently */
    }
  }
}

function isFocusedOn(
  projectId: string,
  activeView: { type: string; id?: string } | undefined,
): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (!activeView) return false;
  if (projectId === MANAGER_PROJECT_ID) return activeView.type === "manager";
  return activeView.type === "project" && activeView.id === projectId;
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
