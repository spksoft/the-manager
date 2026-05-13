import "server-only";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { ackNotifications } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ ids: z.array(z.string()).min(1) });

export async function POST(req: Request) {
  try {
    const { ids } = await parseJson(req, Body);
    ackNotifications(ids);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
