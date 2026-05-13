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
    return jsonOk(await view.stashList());
  } catch (err) {
    return handleErr(err);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    message: z.string().max(2048).optional(),
    includeUntracked: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("apply"),
    index: z.number().int().min(0),
    pop: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("drop"),
    index: z.number().int().min(0),
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
      case "save":
        await view.stashSave(body.message, body.includeUntracked ?? false);
        return jsonOk({ ok: true });
      case "apply":
        await view.stashApply(body.index, body.pop ?? false);
        return jsonOk({ ok: true });
      case "drop":
        await view.stashDrop(body.index);
        return jsonOk({ ok: true });
    }
  } catch (err) {
    return handleErr(err);
  }
}
