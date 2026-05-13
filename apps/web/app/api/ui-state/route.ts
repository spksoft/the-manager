import "server-only";
import { ActiveViewSchema, ManagerTabSchema, ProjectTabSchema } from "@the-manager/persistence";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../lib/api";
import { repos } from "../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchBody = z.object({
  activeView: ActiveViewSchema.optional(),
  activeTabByProject: z.record(ProjectTabSchema).optional(),
  activeTabManager: ManagerTabSchema.optional(),
});

export async function GET() {
  try {
    return jsonOk(await repos.uiState.get());
  } catch (err) {
    return handleErr(err);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await parseJson(req, PatchBody);
    return jsonOk(await repos.uiState.patch(body));
  } catch (err) {
    return handleErr(err);
  }
}
