"use client";

export type SseHandlers = {
  replay?: (chunk: string) => void;
  data?: (chunk: string) => void;
  exit?: (code: number | null) => void;
  error?: (message: string) => void;
};

/**
 * Opens an EventSource at `url` and dispatches each SSE event to `handlers`.
 *
 * Wire format: every server event's `data:` line is a single JSON value (a
 * string for `replay`/`data`/`error`, a number-or-null for `exit`). The server
 * `JSON.stringify`s the payload; we `JSON.parse` it here. This lets pty chunks
 * that contain newlines round-trip cleanly through the SSE framing rules.
 *
 * Returns a cleanup function — call it on component unmount.
 */
export function openSse(url: string, handlers: SseHandlers): () => void {
  const es = new EventSource(url);

  function parse<T>(raw: string | undefined, fallback: T): T {
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  if (handlers.replay) {
    es.addEventListener("replay", (e: MessageEvent) => {
      handlers.replay?.(parse<string>(e.data, ""));
    });
  }
  if (handlers.data) {
    es.addEventListener("data", (e: MessageEvent) => {
      handlers.data?.(parse<string>(e.data, ""));
    });
  }
  if (handlers.exit) {
    es.addEventListener("exit", (e: MessageEvent) => {
      handlers.exit?.(parse<number | null>(e.data, null));
    });
  }
  // Named server-sent `event: error` carries a JSON-encoded string. The
  // EventSource `onerror` (transport-level error) has no `data` — guard for that.
  es.addEventListener("error", (e: Event) => {
    const data = (e as MessageEvent).data as string | undefined;
    handlers.error?.(data ? parse<string>(data, "stream error") : "stream connection error");
  });

  return () => {
    es.close();
  };
}
