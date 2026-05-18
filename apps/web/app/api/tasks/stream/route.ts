import "server-only";
import type { TaskRow } from "@the-manager/persistence";
import { handleErr } from "../../../../lib/api";
import { listTasks, subscribeTasks } from "../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tasks/stream
 *
 * Event types:
 *   event: snapshot   data: TaskRow[]
 *   event: update     data: TaskRow
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

        const onUpdate = (row: TaskRow) => send("update", row);
        const unsubscribe = subscribeTasks(onUpdate);

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

        void listTasks().then((rows) => send("snapshot", rows));
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
