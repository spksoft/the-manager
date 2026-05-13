import "server-only";
import { ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PutBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  baseMtime: z.string(),
});

const DeleteBody = z.object({
  path: z.string().min(1),
});

function requirePath(req: Request): string {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) throw new ValidationError("missing ?path= query");
  return path;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const path = requirePath(req);
    return jsonOk(await repos.fileDrafts.get(id, path));
  } catch (err) {
    return handleErr(err);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, PutBody);
    return jsonOk(
      await repos.fileDrafts.put(id, body.path, {
        content: body.content,
        baseMtime: body.baseMtime,
      }),
    );
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, DeleteBody);
    await repos.fileDrafts.remove(id, body.path);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
