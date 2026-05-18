import "server-only";
import { handleErr } from "../../../../../lib/api";
import {
  getPendingActions,
  type PendingAction,
  subscribeActions,
} from "../../../../../lib/manager-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/manager/actions/stream
 *
 * Event types:
 *   event: enqueued   data: PendingAction
 *   event: resolved   data: { id }
 */
export async function GET(req: Request) {
  try {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            /* aborted */
          }
        };

        const onEnqueued = (a: PendingAction) => send("enqueued", a);
        const onResolved = (a: { id: string }) => send("resolved", a);
        const unsubscribe = subscribeActions({ onEnqueued, onResolved });

        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* */
          }
        };
        req.signal.addEventListener("abort", close, { once: true });

        for (const a of getPendingActions()) send("enqueued", a);
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
