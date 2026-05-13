"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { MobileTerminalKeyBar } from "./MobileTerminalKeyBar";

/**
 * Live general-purpose shell session rendered through xterm.js. Mirrors
 * `TerminalView` (the Claude-specific terminal) but stripped of Claude-only
 * affordances — no mic input, no "fresh conversation" button, no Claude
 * tombstone wording.
 *
 * Wire shape:
 *   - GET /api/projects/[scope]/terminals/[sessionId]/stream?cols=N&rows=M
 *     → SSE of raw output (`event: data, data: "<JSON-encoded chunk>"`).
 *       First N events replay the existing recording; the rest are live.
 *   - POST /api/projects/[scope]/terminals/[sessionId] with
 *       { type: "input", data } or { type: "resize", cols, rows }.
 *
 * The pty is spawned by an explicit POST to /api/projects/[scope]/terminals
 * (handled by the containing panel) — this component only attaches to a
 * session that already exists. A 404 from the stream means the session was
 * killed externally; the error banner surfaces it.
 */
interface ShellTerminalViewProps {
  scope: string;
  sessionId: string;
}

export function ShellTerminalView({ scope, sessionId }: ShellTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hoisted so the mobile on-screen key bar can dispatch keystrokes through
  // the same input path as xterm's `onData`. The backend writes the bytes
  // straight to the pty, so escape sequences (Tab, arrows, Esc) work the
  // same as a hardware press.
  const postInput = useCallback(
    (data: string) =>
      fetch(`/api/projects/${scope}/terminals/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "input", data }),
      }).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      }),
    [scope, sessionId],
  );

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

      const pickFontSize = () => {
        const w = window.innerWidth;
        if (w < 640) return 11;
        if (w < 768) return 12;
        return 13;
      };

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
        fontSize: pickFontSize(),
        theme: { background: "#0a0a0a", foreground: "#e4e4e7" },
        scrollback: 5000,
        convertEol: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (ctrl.signal.aborted) return;

      try {
        fit.fit();
      } catch {
        /* container not measured yet — fallback to xterm defaults */
      }
      const initialCols = term.cols;
      const initialRows = term.rows;
      let lastSentCols = initialCols;
      let lastSentRows = initialRows;

      const postResize = (cols: number, rows: number) => {
        if (cols === lastSentCols && rows === lastSentRows) return;
        lastSentCols = cols;
        lastSentRows = rows;
        void fetch(`/api/projects/${scope}/terminals/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "resize", cols, rows }),
        }).catch(() => {
          /* resize failures are tolerable — next keystroke re-prompts */
        });
      };

      const onDataDisposable = term.onData((data) => {
        void postInput(data);
      });

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const nextFont = pickFontSize();
          if (term.options.fontSize !== nextFont) {
            term.options.fontSize = nextFont;
          }
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
          `/api/projects/${scope}/terminals/${sessionId}/stream?cols=${initialCols}&rows=${initialRows}`,
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
  }, [scope, sessionId, postInput]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div
        ref={containerRef}
        role="application"
        aria-label="Interactive shell terminal"
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-[#0a0a0a] p-1 md:p-2"
      />
      <MobileTerminalKeyBar onKey={postInput} />
    </div>
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
