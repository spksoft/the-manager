import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr } from "../../../../../lib/api";
import { MANAGER_PROJECT_ID } from "../../../../../lib/runtime";
import { endSession } from "../../../../../lib/sessions";
import { sweepEphemeralProjects } from "../../../../../lib/temp-projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Start a new conversation" — kill the live `claude` pty for this project so
 * the next /terminal/stream attach spawns a fresh one. There's no longer a
 * persisted transcript to wipe: history lives only in the running pty's screen
 * state.
 *
 * When the Manager itself is restarted this way, also tear down every
 * ephemeral project the Manager created during its previous run. Those temp
 * projects only made sense in the context of the conversation that just
 * ended — leaving them around as orphans would defeat the "auto-cleanup"
 * promise of `propose_project({ ephemeral: true })`.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    endSession(id as ProjectId);
    if (id === MANAGER_PROJECT_ID) {
      // Run in the foreground but don't fail the response if disk removal
      // hits an EBUSY — the registration was still removed.
      await sweepEphemeralProjects();
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
