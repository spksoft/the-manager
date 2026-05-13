import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);
    return jsonOk(await view.tags());
  } catch (err) {
    return handleErr(err);
  }
}
