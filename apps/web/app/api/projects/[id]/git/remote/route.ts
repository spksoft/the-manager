import "server-only";
import { GitView, type ProgressEvent } from "@the-manager/git";
import { NotFoundError, type ProjectId, ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("fetch"),
    remote: z.string().min(1).max(255).optional(),
    prune: z.boolean().optional(),
    tags: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("pull"),
    remote: z.string().min(1).max(255).optional(),
    branch: z.string().min(1).max(255).optional(),
    rebase: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("push"),
    remote: z.string().min(1).max(255).optional(),
    branch: z.string().min(1).max(255).optional(),
    setUpstream: z.boolean().optional(),
    force: z.boolean().optional(),
    tags: z.boolean().optional(),
  }),
]);

/**
 * POST /api/projects/[id]/git/remote
 *
 * Streams an SSE response with progress events while git fetch/pull/push runs.
 * Event types:
 *   event: progress  data: { stage, progress, processed?, total?, raw? }
 *   event: done      data: { ok: true }
 *   event: error     data: { error, message }
 *
 * Cancellation: client closes the connection → req.signal aborts → driver
 * sends SIGINT to the underlying git child via the AbortSignal it received.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new ValidationError("body must be valid JSON");
    }
    const body = Body.parse(raw);

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
            // already closed
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const onProgress = (e: ProgressEvent) => send("progress", e);
        const opts = {
          onProgress,
          signal: req.signal,
        };

        const run = async () => {
          try {
            switch (body.action) {
              case "fetch":
                await view.fetch({ ...body, ...opts });
                break;
              case "pull":
                await view.pull({ ...body, ...opts });
                break;
              case "push":
                await view.push({ ...body, ...opts });
                break;
            }
            send("done", { ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send("error", { error: "REMOTE_OP_FAILED", message });
          } finally {
            close();
          }
        };
        void run();
        req.signal.addEventListener("abort", close, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return handleErr(err);
  }
}
