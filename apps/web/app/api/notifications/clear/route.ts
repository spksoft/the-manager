import "server-only";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { clearNotifications } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ ids: z.array(z.string()).optional() });

export async function POST(req: Request) {
  try {
    const { ids } = await parseJson(req, Body);
    const removed = clearNotifications(ids);
    return jsonOk({ ok: true, removed });
  } catch (err) {
    return handleErr(err);
  }
}
