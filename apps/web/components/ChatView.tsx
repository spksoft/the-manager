"use client";

import { Button } from "@the-manager/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { Markdown } from "./Markdown";

/**
 * Chat surface for a "claude -p" conversation. One per project (and one for
 * the Manager). Each user message becomes one POST to /api/projects/[id]/
 * messages whose response is an SSE stream of PromptEvents.
 *
 * Wire shape:
 *   - On mount, GET /api/projects/[id]/conversation to hydrate prior history.
 *   - On submit, POST /api/projects/[id]/messages with `{ prompt }` and
 *     read the SSE stream via `fetch` + manual chunk parsing (EventSource
 *     can't POST). Stream events are folded into local state.
 */

// ---------------------------------------------------------------------------
// Wire-format event types — mirrored from packages/drivers/src/prompt-driver.ts
// ---------------------------------------------------------------------------
export type PromptEvent =
  | { type: "session"; conversationId: string; cwd: string; model: string | null }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: unknown; isError: boolean }
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number | null; text: string }
  | { type: "info"; message: string }
  | { type: "error"; message: string };

type TranscriptEntry =
  | { ts: string; kind: "user"; text: string }
  | { ts: string; kind: "event"; event: PromptEvent };

// ---------------------------------------------------------------------------
// Reduced UI message shape — what we actually render.
// ---------------------------------------------------------------------------
interface UserMessage {
  id: string;
  kind: "user";
  text: string;
  ts: string;
}

interface AssistantTurn {
  id: string;
  kind: "assistant";
  ts: string;
  blocks: AssistantBlock[];
  cost: number | null;
  durationMs: number | null;
  pending: boolean;
  errored: boolean;
}

type AssistantBlock =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      result: unknown | null;
      isError: boolean;
    };

type Message = UserMessage | AssistantTurn;

// ---------------------------------------------------------------------------
// Persisted-transcript replay → message list.
// ---------------------------------------------------------------------------
function entriesToMessages(entries: TranscriptEntry[]): Message[] {
  const messages: Message[] = [];
  // Hold the in-progress assistant turn (if any) inside a 1-slot ref so the
  // closure mutations are visible to TypeScript's control-flow analysis.
  const openTurn: { value: AssistantTurn | null } = { value: null };

  const openAssistant = (ts: string): AssistantTurn => {
    const existing = openTurn.value;
    if (existing?.pending) return existing;
    const fresh: AssistantTurn = {
      id: `a-${messages.length}-${ts}`,
      kind: "assistant",
      ts,
      blocks: [],
      cost: null,
      durationMs: null,
      pending: true,
      errored: false,
    };
    openTurn.value = fresh;
    messages.push(fresh);
    return fresh;
  };

  for (const entry of entries) {
    if (entry.kind === "user") {
      const cur = openTurn.value;
      if (cur) {
        cur.pending = false;
        openTurn.value = null;
      }
      messages.push({
        id: `u-${messages.length}-${entry.ts}`,
        kind: "user",
        text: entry.text,
        ts: entry.ts,
      });
    } else {
      const turn = openAssistant(entry.ts);
      applyEvent(turn, entry.event);
      if (entry.event.type === "result" || entry.event.type === "error") {
        turn.pending = false;
        openTurn.value = null;
      }
    }
  }
  return messages;
}

function applyEvent(turn: AssistantTurn, evt: PromptEvent): void {
  switch (evt.type) {
    case "text": {
      const last = turn.blocks[turn.blocks.length - 1];
      if (last && last.kind === "text") last.text += evt.text;
      else turn.blocks.push({ kind: "text", text: evt.text });
      return;
    }
    case "tool_use":
      turn.blocks.push({
        kind: "tool",
        id: evt.id,
        name: evt.name,
        input: evt.input,
        result: null,
        isError: false,
      });
      return;
    case "tool_result": {
      const target = turn.blocks.find((b) => b.kind === "tool" && b.id === evt.toolUseId);
      if (target && target.kind === "tool") {
        target.result = evt.content;
        target.isError = evt.isError;
      }
      return;
    }
    case "result":
      turn.cost = evt.costUsd;
      turn.durationMs = evt.durationMs;
      turn.errored = !evt.ok;
      return;
    case "error":
      turn.errored = true;
      turn.blocks.push({ kind: "text", text: `\n[error] ${evt.message}\n` });
      return;
    case "info":
      // Silent — info events are noise for now.
      return;
    case "session":
      // Metadata; no UI implication.
      return;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface ChatViewProps {
  projectId: string;
  /** Shown in the empty state when no messages exist yet. */
  emptyHint?: string;
}

export function ChatView({ projectId, emptyHint }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate from transcript on mount / when target changes.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setHydrated(false);
    fetch(`/api/projects/${projectId}/conversation`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { entries: TranscriptEntry[] }) => {
        if (cancelled) return;
        setMessages(entriesToMessages(body.entries));
        setHydrated(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Autoscroll to bottom on new content. `messages` length is the load-bearing
  // signal; biome flags `messages` as unnecessary because the body doesn't read
  // it, but that's exactly why it has to be in the deps — it's the trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Clean up any in-flight POST if the component unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setError(null);
    setDraft("");
    setSending(true);

    const userMsg: UserMessage = {
      id: `u-${Date.now()}`,
      kind: "user",
      text,
      ts: new Date().toISOString(),
    };
    const assistant: AssistantTurn = {
      id: `a-${Date.now()}`,
      kind: "assistant",
      ts: new Date().toISOString(),
      blocks: [],
      cost: null,
      durationMs: null,
      pending: true,
      errored: false,
    };
    setMessages((prev) => [...prev, userMsg, assistant]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by blank lines.
        while (true) {
          const idx = buffer.indexOf("\n\n");
          if (idx === -1) break;
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = parseSseChunk(chunk);
          if (!ev) continue;
          if (ev.event === "done") continue;
          if (ev.event === "error") {
            setError(
              typeof ev.data === "object" && ev.data && "message" in ev.data
                ? String((ev.data as { message?: string }).message ?? "error")
                : String(ev.data),
            );
            continue;
          }
          // Treat data as a PromptEvent and fold into the open assistant turn.
          const promptEvent = ev.data as PromptEvent;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (!last || last.kind !== "assistant") return prev;
            const cloned: AssistantTurn = {
              ...last,
              blocks: last.blocks.map((b) => (b.kind === "text" ? { ...b } : { ...b })),
            };
            applyEvent(cloned, promptEvent);
            if (promptEvent.type === "result" || promptEvent.type === "error") {
              cloned.pending = false;
            }
            next[next.length - 1] = cloned;
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.kind === "assistant") {
            next[next.length - 1] = { ...last, pending: false, errored: true };
          }
          return next;
        });
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [draft, projectId, sending]);

  const startFresh = useCallback(async () => {
    if (sending) return;
    setError(null);
    try {
      await fetch(`/api/projects/${projectId}/conversation`, { method: "DELETE" });
      setMessages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, sending]);

  const isEmpty = hydrated && messages.length === 0;
  const hint = useMemo(
    () =>
      emptyHint ??
      "Send a prompt to start. Each message resumes the same Claude conversation in this project's working directory.",
    [emptyHint],
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/20 px-5 py-5"
        aria-live="polite"
      >
        {!hydrated && (
          <div className="flex items-center justify-center py-8 text-xs text-zinc-500">
            Loading conversation…
          </div>
        )}
        {isEmpty && <div className="m-auto max-w-md text-center text-sm text-zinc-500">{hint}</div>}
        {messages.map((m) =>
          m.kind === "user" ? (
            <UserBubble key={m.id} message={m} />
          ) : (
            <AssistantTurnView key={m.id} turn={m} />
          ),
        )}
      </div>

      <form
        className="flex flex-shrink-0 items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          aria-label="Message"
          placeholder="Send a prompt — Enter to send, Shift+Enter for newline"
          disabled={sending}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50"
        />
        <div className="flex flex-col gap-1.5">
          <Button type="submit" disabled={sending || !draft.trim()} aria-label="Send message">
            {sending ? "Sending…" : "Send"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={sending || messages.length === 0}
            onClick={startFresh}
            aria-label="Start a fresh conversation"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            New chat
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subviews
// ---------------------------------------------------------------------------
function UserBubble({ message }: { message: UserMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">You</div>
      <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-zinc-100 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-900">
        {message.text}
      </div>
    </div>
  );
}

function AssistantTurnView({ turn }: { turn: AssistantTurn }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
        <span className="text-emerald-400">◆ Manager</span>
        {turn.pending && (
          <span className="text-zinc-500">
            <span className="inline-block animate-pulse">●</span> thinking
          </span>
        )}
        {!turn.pending && turn.errored && <span className="text-red-400">errored</span>}
      </div>
      <div className="flex max-w-[80%] flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-200">
        {turn.blocks.length === 0 && turn.pending && <span className="text-zinc-500">…</span>}
        {turn.blocks.map((b, i) =>
          b.kind === "text" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are append-only within a turn
            <Markdown key={`t-${i}`} text={b.text} />
          ) : (
            <ToolBlock key={`tool-${b.id}`} block={b} />
          ),
        )}
        {!turn.pending && (turn.cost != null || turn.durationMs != null) && (
          <div className="mt-1 text-[10px] text-zinc-600">
            {turn.durationMs != null && <span>{Math.round(turn.durationMs / 1000)}s</span>}
            {turn.cost != null && (
              <>
                <span className="mx-1.5">·</span>
                <span>${turn.cost.toFixed(4)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBlock({ block }: { block: Extract<AssistantBlock, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => oneLineSummary(block.input), [block.input]);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-xs"
    >
      <summary className="flex cursor-pointer items-center gap-2 list-none">
        <span className="text-zinc-500">⚙</span>
        <span className="font-mono text-zinc-300">{block.name}</span>
        <span className="truncate text-zinc-500">{summary}</span>
        <span className="ml-auto text-zinc-600">
          {block.result == null ? "running…" : block.isError ? "error" : "ok"}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">input</div>
          <pre className="overflow-x-auto rounded bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-300">
            {safeStringify(block.input)}
          </pre>
        </div>
        {block.result != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              result{block.isError ? " (error)" : ""}
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-300">
              {safeStringify(block.result)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function oneLineSummary(input: unknown): string {
  if (!input || typeof input !== "object") return safeStringify(input).slice(0, 80);
  const obj = input as Record<string, unknown>;
  const interesting = ["path", "file_path", "command", "pattern", "url", "prompt"];
  for (const key of interesting) {
    const v = obj[key];
    if (typeof v === "string") return v.slice(0, 80);
  }
  return safeStringify(obj).slice(0, 80);
}

// ---------------------------------------------------------------------------
// SSE chunk parsing
// ---------------------------------------------------------------------------
function parseSseChunk(chunk: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}
