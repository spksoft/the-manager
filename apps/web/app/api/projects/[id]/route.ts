import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../lib/api";
import { repos } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await repos.projects.get(id as ProjectId));
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await repos.projects.remove(id as ProjectId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
