"use client";

import { Button } from "@the-manager/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { MicButton } from "./MicButton";

/**
 * xterm.js touches `self` at module-eval time, which crashes Next's SSR pass.
 * We import it lazily inside the mount effect so only the browser bundle ever
 * evaluates it.
 */

/**
 * Live `claude` session rendered through xterm.js. The whole panel is a
 * thin transport: incoming SSE chunks → term.write; term.onData → POST.
 * No message bubbles, no markdown rendering — the TUI is the UI now.
 *
 * Wire shape:
 *   - GET /api/projects/[id]/terminal/stream?cols=N&rows=M  → SSE of raw
 *     output (`event: data, data: "<JSON-encoded chunk>"`). First N events
 *     replay the existing session screen state; the rest are live.
 *   - POST /api/projects/[id]/terminal with { type: "input", data } for
 *     each keystroke or paste, or { type: "resize", cols, rows } when the
 *     container is resized.
 *   - DELETE /api/projects/[id]/conversation to kill the pty so the next
 *     mount spawns a fresh claude.
 */
interface TerminalViewProps {
  projectId: string;
}

export function TerminalView({ projectId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the connection effect from scratch (spawns fresh).
  const [resetTick, setResetTick] = useState(0);

  // `resetTick` looks unused inside the effect body, but bumping it is exactly
  // the load-bearing signal that the effect should tear down xterm + SSE and
  // start fresh. Biome would otherwise strip it from the deps array.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ctrl = new AbortController();
    let cleanup: (() => void) | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (ctrl.signal.aborted) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        theme: { background: "#0a0a0a", foreground: "#e4e4e7" },
        scrollback: 5000,
        convertEol: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);

      // Wait one frame so the browser has laid out the freshly-injected xterm
      // DOM before we measure it; calling fit() synchronously after open() can
      // read stale dimensions and pick the wrong row count.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (ctrl.signal.aborted) return;

      try {
        fit.fit();
      } catch {
        /* container not measured yet — fallback to xterm defaults */
      }
      const initialCols = term.cols;
      const initialRows = term.rows;
      // Remember the last size we told the server about so we don't POST
      // identical resizes — that's the feedback loop that makes claude redraw
      // its banner repeatedly and pegs the request log.
      let lastSentCols = initialCols;
      let lastSentRows = initialRows;

      const postInput = (data: string) =>
        fetch(`/api/projects/${projectId}/terminal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "input", data }),
        }).catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
        });

      const postResize = (cols: number, rows: number) => {
        if (cols === lastSentCols && rows === lastSentRows) return;
        lastSentCols = cols;
        lastSentRows = rows;
        void fetch(`/api/projects/${projectId}/terminal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "resize", cols, rows }),
        }).catch(() => {
          /* resize failures are tolerable — next keystroke will re-prompt */
        });
      };

      const onDataDisposable = term.onData((data) => {
        void postInput(data);
      });

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          try {
            fit.fit();
          } catch {
            return;
          }
          postResize(term.cols, term.rows);
        }, 150);
      });
      ro.observe(el);

      term.focus();

      cleanup = () => {
        onDataDisposable.dispose();
        ro.disconnect();
        if (resizeTimer) clearTimeout(resizeTimer);
        term.dispose();
      };

      try {
        const res = await fetch(
          `/api/projects/${projectId}/terminal/stream?cols=${initialCols}&rows=${initialRows}`,
          { method: "GET", cache: "no-store", signal: ctrl.signal },
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          while (true) {
            const idx = buffer.indexOf("\n\n");
            if (idx === -1) break;
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const ev = parseSseChunk(chunk);
            if (!ev) continue;
            if (ev.event === "data" && typeof ev.data === "string") {
              term.write(ev.data);
            }
          }
        }
      } catch (e: unknown) {
        if ((e as { name?: string }).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      ctrl.abort();
      cleanup?.();
    };
  }, [projectId, resetTick]);

  const startFresh = useCallback(async () => {
    setError(null);
    try {
      await fetch(`/api/projects/${projectId}/conversation`, { method: "DELETE" });
      setResetTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  // STT → terminal: recognised text is auto-submitted (carriage return appended).
  const handleVoiceInput = useCallback(
    (text: string) => {
      void fetch(`/api/projects/${projectId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "input", data: `${text}\r` }),
      }).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    },
    [projectId],
  );

  return (
    <section className="animate-fade-in flex h-full min-h-0 flex-col gap-2">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div
        ref={containerRef}
        role="application"
        aria-label="Interactive Claude terminal"
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-[#0a0a0a] p-2 transition-colors"
      />
      <div className="flex flex-shrink-0 items-center justify-end gap-2">
        <MicButton onResult={handleVoiceInput} />
        <Button
          type="button"
          variant="ghost"
          onClick={startFresh}
          className="text-xs text-zinc-500 hover:text-zinc-300"
          aria-label="Start a fresh session"
        >
          New session
        </Button>
      </div>
    </section>
  );
}

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
