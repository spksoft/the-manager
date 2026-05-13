import "server-only";
import { handleErr, jsonOk } from "../../../../lib/api";
import { listStatuses } from "../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/sessions/status
 * Returns `{ statuses: { [projectId]: { alive, lastActivityAt } } }` for every
 * known session. Polled by the sidebar to render liveness dots.
 *
 * "Needs human input" detection is deliberately not here yet — it requires
 * parsing the claude TUI for prompt patterns and is intentionally deferred.
 */
export async function GET() {
  try {
    return jsonOk({ statuses: listStatuses() });
  } catch (err) {
    return handleErr(err);
  }
}
