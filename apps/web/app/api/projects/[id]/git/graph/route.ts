import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);

    const url = new URL(req.url);
    const maxRaw = url.searchParams.get("max");
    const refsRaw = url.searchParams.get("refs");
    const max = maxRaw ? Math.min(Math.max(Number.parseInt(maxRaw, 10) || 500, 1), 5000) : 500;
    const refs = refsRaw
      ? refsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const nodes = await view.graph({ max, refs });
    return jsonOk({ nodes });
  } catch (err) {
    return handleErr(err);
  }
}
