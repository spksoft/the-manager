import "server-only";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { setProjectMute } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  projectId: z.string().min(1),
  until: z.union([z.string().datetime(), z.literal("forever")]),
});

export async function POST(req: Request) {
  try {
    const { projectId, until } = await parseJson(req, Body);
    const entry = await setProjectMute(projectId, until);
    return jsonOk({ ok: true, entry });
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return jsonOk({ ok: false, error: "projectId is required" }, { status: 400 });
    await setProjectMute(projectId, null);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleErr(err);
  }
}
