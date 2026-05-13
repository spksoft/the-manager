import "server-only";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);
    return jsonOk(await view.branches());
  } catch (err) {
    return handleErr(err);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).max(255),
    startPoint: z.string().min(1).max(255).optional(),
    checkout: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("rename"),
    from: z.string().min(1).max(255),
    to: z.string().min(1).max(255),
  }),
  z.object({
    action: z.literal("delete"),
    name: z.string().min(1).max(255),
    force: z.boolean().optional(),
    remote: z.string().min(1).max(255).optional(),
  }),
  z.object({
    action: z.literal("checkout"),
    name: z.string().min(1).max(255),
    force: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("set-upstream"),
    branch: z.string().min(1).max(255),
    upstream: z.string().min(1).max(255),
  }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) throw new NotFoundError("git repository", project.path);
    const body = await parseJson(req, Body);
    switch (body.action) {
      case "create":
        if (body.checkout) await view.createAndCheckout(body.name, body.startPoint);
        else await view.createBranch(body.name, body.startPoint);
        return jsonOk({ ok: true });
      case "rename":
        await view.renameBranch(body.from, body.to);
        return jsonOk({ ok: true });
      case "delete":
        if (body.remote) await view.deleteRemoteBranch(body.remote, body.name);
        else await view.deleteBranch(body.name, body.force ?? false);
        return jsonOk({ ok: true });
      case "checkout":
        await view.checkout(body.name, { force: body.force });
        return jsonOk({ ok: true });
      case "set-upstream":
        await view.setUpstream(body.branch, body.upstream);
        return jsonOk({ ok: true });
    }
  } catch (err) {
    return handleErr(err);
  }
}
