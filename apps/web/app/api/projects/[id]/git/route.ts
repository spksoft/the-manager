import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId, ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../lib/api";
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

const ActionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stage"), paths: z.array(z.string().min(1)).min(1) }),
  z.object({ action: z.literal("unstage"), paths: z.array(z.string().min(1)).min(1) }),
  z.object({ action: z.literal("commit"), message: z.string().min(1).max(10_000) }),
  z.object({
    action: z.literal("init"),
    // Empty/whitespace strings are normalised to `undefined` so the route can
    // skip the remote-add step without a separate "has remote" flag.
    remoteUrl: z
      .string()
      .max(2048)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  }),
]);

/**
 * Single mutation endpoint for the Git tab. We bundle stage/unstage/commit
 * behind an action discriminator so the client only needs one URL and the
 * route stays close to the GET that hydrates the tab.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    const body = await parseJson(req, ActionBody);

    // `init` is the only action allowed on a non-repo cwd; all others need
    // an existing repository.
    if (body.action !== "init" && !(await view.isRepository())) {
      throw new NotFoundError("git repository", project.path);
    }

    switch (body.action) {
      case "init":
        if (await view.isRepository()) {
          throw new ValidationError("already a git repository");
        }
        await view.init(body.remoteUrl);
        return jsonOk({ ok: true });
      case "stage":
        await view.stage(body.paths);
        return jsonOk({ ok: true });
      case "unstage":
        await view.unstage(body.paths);
        return jsonOk({ ok: true });
      case "commit": {
        const diff = await view.stagedDiff();
        if (diff.trim().length === 0) {
          throw new ValidationError("nothing staged to commit");
        }
        const { hash } = await view.commit(body.message);
        return jsonOk({ ok: true, hash });
      }
    }
  } catch (err) {
    return handleErr(err);
  }
}
