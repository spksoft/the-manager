import "server-only";
import { createSettingsStore } from "@the-manager/persistence";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const store = createSettingsStore();

const PatchBody = z.object({
  recentProjectIds: z.array(z.string().uuid()).optional(),
  flags: z.record(z.boolean()).optional(),
  network: z
    .object({
      preferredPort: z.number().int().min(1024).max(65535).nullable(),
    })
    .optional(),
});

export async function GET() {
  try {
    return jsonOk(await store.load());
  } catch (err) {
    return handleErr(err);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await parseJson(req, PatchBody);
    const next = await store.update((current) => ({
      ...current,
      data: {
        ...current.data,
        recentProjectIds: body.recentProjectIds ?? current.data.recentProjectIds,
        flags: body.flags ? { ...current.data.flags, ...body.flags } : current.data.flags,
        network: body.network ? { ...current.data.network, ...body.network } : current.data.network,
      },
    }));
    return jsonOk(next);
  } catch (err) {
    return handleErr(err);
  }
}
