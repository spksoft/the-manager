import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { MANAGER_PROJECT_ID } from "../../../../lib/manager-id";
import { getOrCreateSession, writeInput } from "../../../../lib/sessions";
import { createTask } from "../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  text: z.string().min(1).max(40_000),
  /** When true, also press Enter to submit. Defaults to true. */
  submit: z.boolean().optional(),
});

/**
 * POST /api/manager/ask
 *
 * Sends a prompt to the Manager's interactive `claude` session. Spawns the
 * session if it isn't already running. Used by the command palette so the
 * user can issue Manager commands without first navigating to the Manager
 * view and typing into the terminal.
 */
export async function POST(req: Request) {
  try {
    const body = await parseJson(req, Body);
    const projectId = MANAGER_PROJECT_ID as ProjectId;
    await getOrCreateSession(projectId, 120, 32);
    writeInput(projectId, body.text);
    if (body.submit !== false) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      writeInput(projectId, "\r");
    }
    const task = await createTask({
      requestedBy: "user",
      targetProjectId: projectId,
      targetSessionId: null,
      payload: body.text,
    });
    return jsonOk({ taskId: task.id });
  } catch (err) {
    return handleErr(err);
  }
}
