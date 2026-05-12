import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr } from "../../../../../../lib/api";
import { attach, getOrCreateSession } from "../../../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/terminal/stream?cols=N&rows=M
 *
 * Opens the project's (or Manager's) interactive `claude` session if it's
 * not already running, sized to the requested cols×rows, then streams raw
 * pty output as SSE. Each chunk arrives as:
 *
 *   event: data
 *   data: "<JSON-encoded raw bytes>"
 *
 * On attach, we first replay the existing recording so the client's xterm
 * renders the prior screen state, then continue with live updates. The
 * stream closes when the client disconnects; the underlying session keeps
 * running until DELETEd on the conversation endpoint.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const cols = clampDim(url.searchParams.get("cols"), 120, 20, 400);
    const rows = clampDim(url.searchParams.get("rows"), 32, 5, 200);

    const session = await getOrCreateSession(id as ProjectId, cols, rows);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: data\ndata: ${JSON.stringify(chunk)}\n\n`));
          } catch {
            // Controller already closed by abort — drop silently.
          }
        };

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
        const { initial, unsubscribe } = attach(session, send, close);
        for (const chunk of initial) send(chunk);
        req.signal.addEventListener("abort", close, { once: true });
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

function clampDim(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
