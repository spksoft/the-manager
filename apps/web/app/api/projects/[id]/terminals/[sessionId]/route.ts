import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonErr, jsonOk } from "../../../../../../lib/api";
import { kill, resize, writeInput } from "../../../../../../lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/terminals/[sessionId]
 *
 * Send keystrokes or resize a pty for a specific shell session.
 *
 * Body is a discriminated union (same shape as the Claude terminal route):
 *   { "type": "input", "data": "ls\r" }
 *   { "type": "resize", "cols": 120, "rows": 32 }
 *
 * Returns 409 if no live session exists for this scope/sessionId — clients
 * must POST /api/projects/[id]/terminals first to spawn one.
 */
const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string() }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  try {
    const { id, sessionId } = await ctx.params;
    const raw = await req.json().catch(() => {
      throw new ValidationError("body must be valid JSON");
    });
    const cmd = CommandSchema.parse(raw);
    const projectId = id as ProjectId;
    const ok =
      cmd.type === "input"
        ? writeInput(projectId, sessionId, cmd.data)
        : resize(projectId, sessionId, cmd.cols, cmd.rows);
    if (!ok) {
      return jsonErr(409, "NO_SESSION", "no live shell session for this id");
    }
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}

/**
 * DELETE /api/projects/[id]/terminals/[sessionId]
 *
 * Kill the underlying pty. Idempotent — returns 204 whether the session was
 * alive or already gone.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  try {
    const { id, sessionId } = await ctx.params;
    kill(id as ProjectId, sessionId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
