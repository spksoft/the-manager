import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { paths } from "@the-manager/persistence";
import type { AssetId } from "@the-manager/shared";
import { handleErr } from "../../../../../lib/api";
import { repos } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const asset = await repos.assets.get(id as AssetId);
    const blobPath = paths.assetBlob(asset.sha256);
    const s = await stat(blobPath);
    const nodeStream = createReadStream(blobPath);
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk) => {
          controller.enqueue(
            chunk instanceof Buffer
              ? new Uint8Array(chunk)
              : new TextEncoder().encode(String(chunk)),
          );
        });
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(s.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return handleErr(err);
  }
}
