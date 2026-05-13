import "server-only";
import { GitView } from "@the-manager/git";
import type { ProjectId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../lib/api";
import { repos } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Bundles the three reads the mini git display needs (status, log, branch) into
 * one round-trip. If the project isn't a git repo we return null shapes rather
 * than 404 — the UI knows how to render "not a repo".
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) {
      return jsonOk({ isRepo: false, branch: null, status: null, log: [] });
    }
    // `?diff=<path>` short-circuits the bundled response and returns just the
    // staged + unstaged diff for one file. Cheaper than re-loading status + log
    // for every selection click.
    const url = new URL(req.url);
    const diffPath = url.searchParams.get("diff");
    if (diffPath !== null) {
      const { staged, unstaged } = await view.fileDiff(diffPath);
      return jsonOk({ path: diffPath, staged, unstaged });
    }
    const branch = await view.currentBranch();
    // Empty repo (no commits yet) — return empty log/status rather than 500ing.
    const [status, log] = await Promise.all([
      view.status().catch(() => null),
      view.log(50).catch(() => ({
        all: [] as { hash: string; date: string; message: string; author_name: string }[],
      })),
    ]);
    if (!status) {
      return jsonOk({ isRepo: true, branch, status: null, log: [] });
    }
    return jsonOk({
      isRepo: true,
      branch,
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        not_added: status.not_added,
        deleted: status.deleted,
        renamed: status.renamed,
        conflicted: status.conflicted,
        files: status.files.map((f) => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir,
        })),
      },
      log: log.all.map((c) => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author: c.author_name,
      })),
    });
  } catch (err) {
    return handleErr(err);
  }
}
