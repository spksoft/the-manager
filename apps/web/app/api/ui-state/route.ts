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
  // 16 KiB per project cap — a commit message body that long is almost
  // certainly Claude pasting back the diff. Reject before it hits disk.
  commitMessageDraftByProject: z.record(z.string().max(16_384)).optional(),
  terminalDrawer: z
    .object({
      expanded: z.boolean(),
      heightPx: z.number().int().positive().max(2000),
    })
    .partial()
    .optional(),
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
