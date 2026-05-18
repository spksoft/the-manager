import "server-only";
import { type ProjectId, ValidationError } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../lib/api";
import { regenerateProjectDescription } from "../../../../../lib/project-description";
import { repos } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual "Regenerate" trigger from the edit dialog. Synchronously runs
 * `claude -p` against the project's directory, saves the result, and returns
 * the updated row. Auto-generation on project creation goes through the
 * fire-and-forget path in POST /api/projects instead.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = id as ProjectId;
    // Touch the row first so we 404 cleanly instead of timing out inside claude.
    await repos.projects.get(projectId);
    const description = await regenerateProjectDescription(projectId);
    if (description === null) {
      throw new ValidationError(
        "could not draft a description — see server logs for the claude -p failure",
      );
    }
    const project = await repos.projects.get(projectId);
    return jsonOk({ project, description });
  } catch (err) {
    return handleErr(err);
  }
}
