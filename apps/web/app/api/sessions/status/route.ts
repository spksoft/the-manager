import "server-only";
import { handleErr, jsonOk } from "../../../../lib/api";
import { listStatuses } from "../../../../lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/sessions/status
 * Returns `{ statuses: { [projectId]: { alive, lastActivityAt, readyAt } } }`
 * for every known session. Polled by the sidebar to render liveness dots and
 * by the notification bell to detect working → idle transitions (readyAt
 * bumps).
 */
export async function GET() {
  try {
    return jsonOk({ statuses: listStatuses() });
  } catch (err) {
    return handleErr(err);
  }
}
