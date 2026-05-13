import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  branch: z.string().min(1).max(255),
  noFastForward: z.boolean().optional(),
  squash: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);
    const body = await parseJson(req, Body);
    await view.merge(body.branch, { noFastForward: body.noFastForward, squash: body.squash });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
