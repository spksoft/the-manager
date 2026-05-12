import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr } from "../../../../../lib/api";
import { sendPrompt } from "../../../../../lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST a chat message to the project's (or Manager's) Claude conversation.
 *
 * Body: `{ "prompt": "<user message>" }`.
 * Response: text/event-stream with one SSE event per PromptEvent, where the
 * `data:` line is the JSON-encoded event. Stream ends when the prompt
 * resolves (`result`) or errors (`error`).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          for await (const evt of sendPrompt(id as ProjectId, body, req.signal)) {
            send(evt.type, evt);
            if (req.signal.aborted) break;
          }
          send("done", { ok: true });
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : String(err),
            code: (err as { code?: string }).code,
          });
        } finally {
          controller.close();
        }
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
