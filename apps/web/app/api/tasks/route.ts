import "server-only";
import { handleErr, jsonOk } from "../../../lib/api";
import { listTasks } from "../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk(await listTasks());
  } catch (err) {
    return handleErr(err);
  }
}
