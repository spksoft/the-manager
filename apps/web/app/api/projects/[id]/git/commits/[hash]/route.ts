import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId, ValidationError } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../../../lib/api";
import { repos } from "../../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HASH_RE = /^[a-f0-9]{4,40}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string; hash: string }> }) {
  try {
    const { id, hash } = await ctx.params;
    if (!HASH_RE.test(hash)) throw new ValidationError("invalid commit hash");
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);

    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (path !== null) {
      return jsonOk({ hash, path, diff: await view.commitFileDiff(hash, path) });
    }
    return jsonOk(await view.commitDetails(hash));
  } catch (err) {
    return handleErr(err);
  }
}
