import "server-only";
import { ProjectSchema } from "@the-manager/persistence";
import { NotFoundError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../lib/api";
import { resolveProposal } from "../../../../../lib/manager-requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/manager/requests/[id]
 *
 * Resolves a pending Manager proposal. Body shape:
 *   { kind: "confirmed", project: ProjectRow }
 *   { kind: "cancelled" }
 *
 * `kind: "confirmed"` happens after the UI has already POSTed `/api/projects`
 * to create the actual record — the project payload is the row returned by
 * that call, threaded back to the Manager via the proposal's Promise.
 */
const Body = z.union([
  z.object({ kind: z.literal("confirmed"), project: ProjectSchema }),
  z.object({ kind: z.literal("cancelled") }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, Body);
    const ok =
      body.kind === "confirmed"
        ? resolveProposal(id, { kind: "confirmed", project: body.project })
        : resolveProposal(id, { kind: "cancelled", reason: "user" });
    if (!ok) throw new NotFoundError("ManagerRequest", id);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
