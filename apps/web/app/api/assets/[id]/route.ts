import "server-only";
import type { AssetId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../lib/api";
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

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await repos.assets.remove(id as AssetId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
