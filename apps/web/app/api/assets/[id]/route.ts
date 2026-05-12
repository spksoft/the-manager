import "server-only";
import type { AssetId } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { repos } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await repos.assets.get(id as AssetId));
  } catch (err) {
    return handleErr(err);
  }
}

const PatchBody = z
  .object({
    filename: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    scope: z.union([z.literal("global"), z.object({ projectId: z.string().uuid() })]).optional(),
    folder: z.string().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one of filename, tags, scope, folder must be provided",
  });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const patch = await parseJson(req, PatchBody);
    const updated = await repos.assets.update(id as AssetId, patch);
    return jsonOk(updated);
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await repos.assets.remove(id as AssetId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
