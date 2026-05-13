import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr, jsonErr } from "../../../../../../../lib/api";
import { attach, getSession } from "../../../../../../../lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/terminals/[sessionId]/stream?cols=N&rows=M
 *
 * Attach to an already-spawned shell session and stream raw pty output as
 * SSE. Each chunk arrives as:
 *
 *   event: data
 *   data: "<JSON-encoded raw bytes>"
 *
 * On attach we first replay the existing recording so the client's xterm
 * renders the prior screen state, then continue with live updates. Unlike
 * the Claude terminal stream, this route does NOT auto-spawn a session —
 * 404 is returned if `sessionId` is unknown or already exited. Spawning is
 * exclusively the POST /terminals create path.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  try {
    const { id, sessionId } = await ctx.params;
    const session = getSession(id as ProjectId, sessionId);
    if (!session) {
      return jsonErr(404, "NO_SESSION", "no live shell session for this id");
    }

    const url = new URL(req.url);
    const cols = clampDim(url.searchParams.get("cols"), session.cols, 20, 400);
    const rows = clampDim(url.searchParams.get("rows"), session.rows, 5, 200);
    if (cols !== session.cols || rows !== session.rows) {
      session.handle.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: data\ndata: ${JSON.stringify(chunk)}\n\n`));
          } catch {
            /* controller already closed */
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
