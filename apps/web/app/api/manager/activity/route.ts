import "server-only";
import { aggregate, type SessionActivity } from "@the-manager/core";
import { handleErr } from "../../../../lib/api";
import { activitySnapshot, subscribeActivity } from "../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/manager/activity
 *
 * SSE stream of per-session activity. On attach we send a `snapshot` event
 * with the current AggregateActivity, then push:
 *   event: update    data: <SessionActivity JSON>
 *   event: gone      data: { projectId }
 * The client maintains its own aggregate from these deltas.
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

        const onUpdate = (s: SessionActivity) => send("update", s);
        const onGone = (projectId: string) => send("gone", { projectId });
        const unsubscribe = subscribeActivity({ onUpdate, onGone });

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

        send("snapshot", aggregate(activitySnapshot()));
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
