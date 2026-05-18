import "server-only";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type ProjectId, ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { repos } from "../../../../lib/runtime";
import { endSession } from "../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await repos.projects.get(id as ProjectId));
  } catch (err) {
    return handleErr(err);
  }
}

const PatchBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    defaultDriver: z.enum(["claude", "codex", "gemini"]).optional(),
    path: z.string().min(1).optional(),
    /** Pass null to clear; empty string is rejected so callers don't blank by accident. */
    description: z.string().min(1).max(400).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one of name, defaultDriver, path, description must be provided",
  });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const patch = await parseJson(req, PatchBody);
    if (patch.path !== undefined) {
      if (!isAbsolute(patch.path)) throw new ValidationError("path must be absolute");
      try {
        const s = await stat(patch.path);
        if (!s.isDirectory()) throw new ValidationError("path is not a directory");
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(`path does not exist or is not readable: ${patch.path}`);
      }
    }

    const before = await repos.projects.get(id as ProjectId);
    const updated = await repos.projects.update(id as ProjectId, patch);
    // A path change strands the live pty (it was spawned with the old cwd) —
    // kill the session so the next /terminal/stream attach respawns under the
    // new directory.
    if (patch.path !== undefined && before.path !== updated.path) {
      endSession(id as ProjectId);
    }
    return jsonOk(updated);
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await repos.projects.remove(id as ProjectId);
    await repos.uiState.forgetProject(id);
    await repos.fileDrafts.forgetProject(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
