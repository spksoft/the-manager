import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr } from "../../../../../lib/api";
import { endSession } from "../../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Start a new conversation" — kill the live `claude` pty for this project so
 * the next /terminal/stream attach spawns a fresh one. There's no longer a
 * persisted transcript to wipe: history lives only in the running pty's screen
 * state.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    endSession(id as ProjectId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
