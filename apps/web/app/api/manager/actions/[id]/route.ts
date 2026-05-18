import "server-only";
import { NotFoundError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../lib/api";
import { resolveAction } from "../../../../../lib/manager-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.union([
  z.object({ kind: z.literal("approved") }),
  z.object({ kind: z.literal("rejected") }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, Body);
    const ok =
      body.kind === "approved"
        ? resolveAction(id, { kind: "approved" })
        : resolveAction(id, { kind: "rejected", reason: "user" });
    if (!ok) throw new NotFoundError("ManagerAction", id);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
