import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["stage", "unstage"]),
  patch: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);
    const body = await parseJson(req, Body);
    await view.applyHunkPatch(body.patch, { reverse: body.action === "unstage" });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
