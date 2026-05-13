import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../lib/api";
import { createSession, listSessions } from "../../../../../lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * General-purpose shell terminals for a scope (a project id, or the synthetic
 * Manager id).
 *
 *   GET  /api/projects/[id]/terminals
 *     → [{ sessionId, label, createdAt }, ...]
 *
 *   POST /api/projects/[id]/terminals  { cols, rows }
 *     → 201 { sessionId, label, createdAt }
 *
 * The pty is born sized to (cols, rows). Spawning a new shell is the only way
 * to obtain a sessionId — there is no auto-spawn on the stream route.
 */

const CreateBody = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return jsonOk(listSessions(id as ProjectId));
  } catch (err) {
    return handleErr(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, CreateBody);
    const meta = await createSession(id as ProjectId, body.cols, body.rows);
    return jsonOk(meta, { status: 201 });
  } catch (err) {
    return handleErr(err);
  }
}
