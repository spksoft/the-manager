"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { cn } from "@the-manager/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProjects } from "../lib/hooks";
import type { ActiveView } from "./Sidebar";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate?: (view: ActiveView) => void;
}

type ActionKind =
  | { kind: "ask_manager"; text: string }
  | { kind: "fan_out"; text: string }
  | { kind: "nav"; view: ActiveView; label: string }
  | { kind: "recent"; text: string };

interface Entry {
  id: string;
  label: string;
  hint: string;
  action: ActionKind;
  /** Used to filter and sort. Higher matches show first. */
  score: number;
}

const RECENT_KEY = "the-manager.palette.recent";
const RECENT_MAX = 10;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const cur = loadRecent().filter((x) => x !== trimmed);
  const next = [trimmed, ...cur].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export function CommandPalette({ open, onClose, onNavigate }: CommandPaletteProps) {
  const { data: projects = [] } = useProjects();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    setQuery("");
    setSelected(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const entries = useMemo(() => buildEntries(query, projects, loadRecent()), [query, projects]);

  useEffect(() => {
    if (selected >= entries.length) setSelected(0);
  }, [entries, selected]);

  if (!open) return null;

  const focused = entries[selected];

  const execute = async (entry: Entry) => {
    if (busy) return;
    setBusy(true);
    try {
      const action = entry.action;
      if (action.kind === "ask_manager" || action.kind === "recent") {
        saveRecent(action.text);
        onNavigate?.({ type: "manager" });
        await fetch("/api/manager/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: action.text }),
        });
      } else if (action.kind === "fan_out") {
        saveRecent(action.text);
        // Best-effort: hit the MCP fan-out via a thin shim. For now we tell the
        // Manager to fan out via natural language — keeps the API surface tight.
        await fetch("/api/manager/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Run on every project: ${action.text}`,
          }),
        });
        onNavigate?.({ type: "manager" });
      } else if (action.kind === "nav") {
        onNavigate?.(action.view);
      }
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl md:top-[15vh]"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <span className="text-zinc-500" aria-hidden>
            ⌘
          </span>
          <input
            ref={inputRef}
            type="search"
            id="command-palette-title"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, entries.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) {
                  if (query.trim()) {
                    void execute({
                      id: "fanout",
                      label: query,
                      hint: "Run on all projects",
                      score: 0,
                      action: { kind: "fan_out", text: query },
                    });
                  }
                } else if (focused) {
                  void execute(focused);
                }
              }
            }}
            placeholder="Ask the Manager, jump to a project, or run a command…"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            disabled={busy}
          />
          <kbd
            className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
            aria-label="Escape to close"
          >
            ESC
          </kbd>
        </div>
        <ul
          ref={listRef}
          aria-label="Command palette results"
          className="max-h-80 overflow-y-auto py-1"
        >
          {entries.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-zinc-500">No matches</li>
          ) : (
            entries.map((entry, idx) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => void execute(entry)}
                  onMouseEnter={() => setSelected(idx)}
                  disabled={busy}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition",
                    idx === selected
                      ? "bg-emerald-500/15 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800/60",
                  )}
                >
                  <span className="flex-shrink-0 text-zinc-500">{badge(entry)}</span>
                  <span className="flex-1 truncate">{entry.label}</span>
                  <span className="flex-shrink-0 text-xs text-zinc-500">{entry.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <footer className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          <span>↑↓ navigate · ↵ run · ⌘↵ run on all projects</span>
          <span>
            {busy ? "Working…" : `${entries.length} option${entries.length === 1 ? "" : "s"}`}
          </span>
        </footer>
      </div>
    </>
  );
}

function badge(entry: Entry): string {
  switch (entry.action.kind) {
    case "ask_manager":
      return "Ask";
    case "fan_out":
      return "Fan";
    case "nav":
      return "Go";
    case "recent":
      return "Recent";
  }
}

function buildEntries(query: string, projects: ProjectRow[], recent: string[]): Entry[] {
  const q = query.trim();
  const lower = q.toLowerCase();
  const out: Entry[] = [];

  // Navigation entries
  pushNav(out, {
    id: "nav:manager",
    view: { type: "manager" },
    label: "Manager",
    hint: "Open Manager view",
  });
  pushNav(out, {
    id: "nav:assets",
    view: { type: "assets" },
    label: "Assets",
    hint: "Open shared asset browser",
  });
  for (const p of projects) {
    pushNav(out, {
      id: `nav:project:${p.id}`,
      view: { type: "project", id: p.id },
      label: p.name,
      hint: p.path,
    });
  }

  // Recent prompts (when query is empty)
  if (q.length === 0) {
    for (const text of recent) {
      out.push({
        id: `recent:${text}`,
        label: text,
        hint: "Recent",
        action: { kind: "recent", text },
        score: 0.6,
      });
    }
  }

  // Score filtering
  let filtered = q.length === 0 ? out : out.filter((e) => fuzzy(e.label, lower) > 0);
  for (const e of filtered) e.score = q.length === 0 ? e.score : fuzzy(e.label, lower);
  filtered.sort((a, b) => b.score - a.score);

  // Always include "Ask Manager: <q>" as a top option when the query has content.
  if (q.length > 0) {
    filtered = [
      {
        id: "ask",
        label: `Ask Manager: ${q}`,
        hint: "↵",
        action: { kind: "ask_manager", text: q },
        score: 100,
      },
      ...filtered,
    ];
  }

  return filtered.slice(0, 12);
}

function pushNav(
  list: Entry[],
  args: { id: string; view: ActiveView; label: string; hint: string },
): void {
  list.push({
    id: args.id,
    label: args.label,
    hint: args.hint,
    action: { kind: "nav", view: args.view, label: args.label },
    score: 0.5,
  });
}

function fuzzy(label: string, lowerQuery: string): number {
  if (lowerQuery.length === 0) return 1;
  const hay = label.toLowerCase();
  if (hay === lowerQuery) return 10;
  if (hay.startsWith(lowerQuery)) return 5;
  if (hay.includes(lowerQuery)) return 2;
  let qi = 0;
  for (let i = 0; i < hay.length && qi < lowerQuery.length; i++) {
    if (hay[i] === lowerQuery[qi]) qi++;
  }
  return qi === lowerQuery.length ? 0.5 : 0;
}
