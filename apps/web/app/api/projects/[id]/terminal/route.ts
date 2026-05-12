import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonErr, jsonOk } from "../../../../../lib/api";
import { resize, writeInput } from "../../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/terminal
 *
 * Send keystrokes or resize the pty for an already-attached session.
 *
 * Body is a discriminated union:
 *   { "type": "input", "data": "ls\r" }
 *   { "type": "resize", "cols": 120, "rows": 32 }
 *
 * Returns 409 if no live session exists for this project — the client must
 * GET /terminal/stream first to spawn one (which is also how the pty
 * dimensions are established).
 */
const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string() }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raw = await req.json().catch(() => {
      throw new ValidationError("body must be valid JSON");
    });
    const cmd = CommandSchema.parse(raw);

    const projectId = id as ProjectId;
    const ok =
      cmd.type === "input"
        ? writeInput(projectId, cmd.data)
        : resize(projectId, cmd.cols, cmd.rows);
    if (!ok) {
      return jsonErr(
        409,
        "NO_SESSION",
        "no live claude session for this project — open the terminal stream first",
      );
    }
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
