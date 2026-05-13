import "server-only";
import { handleErr } from "../../../../lib/api";
import {
  getNotificationSnapshot,
  type NotificationEvent,
  subscribeNotifications,
} from "../../../../lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/notifications/stream
 *
 * SSE channel for the notification bell. On attach we emit one `snapshot` with
 * the current ring buffer + mute table so a fresh tab/refresh hydrates without
 * a separate REST call. Subsequent events stream live.
 *
 * Event types:
 *   event: snapshot   data: { events: NotificationEvent[], muted: MuteEntry[] }
 *   event: event      data: NotificationEvent
 *   event: ack        data: { ids: string[] }
 *   event: mute       data: { projectId, entry: MuteEntry | null }
 *   event: clear      data: { ids: string[] }
 */
export async function GET(req: Request) {
  try {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            /* controller closed by abort — drop */
          }
        };

        const unsubscribe = subscribeNotifications({
          onEvent: (e: NotificationEvent) => send("event", e),
          onAck: (p) => send("ack", p),
          onMute: (p) => send("mute", p),
          onClear: (p) => send("clear", p),
        });

        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        req.signal.addEventListener("abort", close, { once: true });

        // Snapshot after subscribing so we don't miss anything between snap
        // and subscribe (mirrors manager/requests/stream).
        const snapshot = await getNotificationSnapshot();
        send("snapshot", snapshot);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleErr(err);
  }
}
