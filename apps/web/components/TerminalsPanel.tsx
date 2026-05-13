"use client";

import { cn } from "@the-manager/ui";
import { useCallback, useEffect, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { ShellTerminalView } from "./ShellTerminalView";

/**
 * Tab strip + active ShellTerminalView for a single scope (a project id, or
 * the synthetic Manager id). Sessions are server-owned and survive client
 * unmounts — this panel just enumerates them on mount and exposes spawn/kill
 * buttons. Only the active session's xterm is mounted; inactive ones are
 * fully unmounted (FitAddon breaks on 0-dim containers, and the server-side
 * recording is the persistence — re-mount replays it).
 */

interface SessionMeta {
  sessionId: string;
  label: string;
  createdAt: string;
}

interface TerminalsPanelProps {
  scope: string;
}

const SPAWN_COLS = 80;
const SPAWN_ROWS = 24;

export function TerminalsPanel({ scope }: TerminalsPanelProps) {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Initial load — hydrate the tab strip from whatever the server already has.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${scope}/terminals`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()) as SessionMeta[];
        if (cancelled) return;
        setSessions(list);
        const first = list[0];
        if (first) setActiveId((cur) => cur ?? first.sessionId);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const spawn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${scope}/terminals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols: SPAWN_COLS, rows: SPAWN_ROWS }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = (await res.json()) as SessionMeta;
      setSessions((prev) => [...(prev ?? []), meta]);
      setActiveId(meta.sessionId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [scope]);

  const killSession = useCallback(
    async (sessionId: string) => {
      setError(null);
      try {
        await fetch(`/api/projects/${scope}/terminals/${sessionId}`, { method: "DELETE" });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setSessions((prev) => {
        const next = (prev ?? []).filter((s) => s.sessionId !== sessionId);
        // If we just killed the active tab, jump to a neighbour.
        if (activeId === sessionId) {
          setActiveId(next[0]?.sessionId ?? null);
        }
        return next;
      });
    },
    [scope, activeId],
  );

  // Active session may have been removed under us (kill race) — clamp activeId.
  useEffect(() => {
    if (!sessions || sessions.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (activeId && !sessions.some((s) => s.sessionId === activeId)) {
      const first = sessions[0];
      if (first) setActiveId(first.sessionId);
    }
  }, [sessions, activeId]);

  if (sessions === null) {
    return <div className="flex h-full items-center justify-center text-xs text-zinc-500">…</div>;
  }

  const isEmpty = sessions.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <div className="px-2 pt-2">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* Tab strip */}
      <div
        role="tablist"
        aria-label="Shell terminals"
        className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950/40 px-1 py-1"
      >
        {sessions.map((s) => {
          const active = s.sessionId === activeId;
          return (
            <div
              key={s.sessionId}
              className={cn(
                "group flex items-center gap-1 rounded-md text-xs",
                active
                  ? "bg-zinc-800/80 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveId(s.sessionId)}
                className="px-2 py-1"
              >
                {s.label}
              </button>
              <button
                type="button"
                aria-label={`Close ${s.label}`}
                onClick={() => void killSession(s.sessionId)}
                className="px-1 py-1 text-zinc-500 opacity-60 hover:text-red-300 hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => void spawn()}
          disabled={busy}
          aria-label="New terminal"
          className="ml-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100 disabled:opacity-50"
        >
          +
        </button>
      </div>

      {/* Active terminal (or empty state) */}
      <div className="min-h-0 flex-1 p-2">
        {isEmpty || !activeId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
            <div className="text-sm">No terminals</div>
            <button
              type="button"
              onClick={() => void spawn()}
              disabled={busy}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/40 disabled:opacity-50"
            >
              + New terminal
            </button>
          </div>
        ) : (
          <ShellTerminalView key={activeId} scope={scope} sessionId={activeId} />
        )}
      </div>
    </div>
  );
}
