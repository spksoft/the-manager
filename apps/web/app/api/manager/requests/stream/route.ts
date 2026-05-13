import "server-only";
import { handleErr } from "../../../../../lib/api";
import {
  getPendingProposals,
  type PendingProjectProposal,
  subscribeProposals,
} from "../../../../../lib/manager-requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/manager/requests/stream
 *
 * SSE channel that surfaces UI proposals enqueued by the Manager's MCP tools.
 * On attach, we first replay every currently-pending proposal so a freshly
 * mounted broker can open dialogs for in-flight requests (e.g. after a page
 * reload while a Manager tool was waiting). Subsequent enqueues/resolves are
 * pushed live.
 *
 * Event types:
 *   event: enqueued   data: <PendingProjectProposal JSON>
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
            /* controller closed by abort — drop */
          }
        };

        const onEnqueued = (p: PendingProjectProposal) => send("enqueued", p);
        const onResolved = (p: { id: string }) => send("resolved", p);
        const unsubscribe = subscribeProposals({ onEnqueued, onResolved });

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

        // Replay current pending proposals AFTER subscribing so we don't lose
        // anything that arrives between snapshot and subscribe.
        for (const p of getPendingProposals()) send("enqueued", p);
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
