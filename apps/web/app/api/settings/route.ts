import "server-only";
import { JsonStore, paths, SettingsSchema } from "@the-manager/persistence";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const defaultSettings = () => ({
  version: 1 as const,
  data: {
    recentProjectIds: [] as string[],
    windowState: null,
    flags: {} as Record<string, boolean>,
  },
});

const store = new JsonStore(paths.settings(), SettingsSchema, defaultSettings);

const PatchBody = z.object({
  recentProjectIds: z.array(z.string().uuid()).optional(),
  flags: z.record(z.boolean()).optional(),
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
      },
    }));
    return jsonOk(next);
  } catch (err) {
    return handleErr(err);
  }
}
