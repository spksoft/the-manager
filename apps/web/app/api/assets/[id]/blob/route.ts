import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { paths } from "@the-manager/persistence";
import { type AssetId, ValidationError } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../lib/api";
import { repos } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // mirrors POST /api/assets

/**
 * Replace an existing asset's blob content while preserving the asset id and
 * its mutable metadata (filename, tags, scope, folder). The new bytes are
 * content-addressed under their fresh sha256; the previous blob is intentionally
 * NOT removed because we don't track inbound references. A future GC sweep can
 * collect orphans by diffing the index against the blobs directory.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    // Ensure the asset exists before reading the upload body so a bad id fails fast.
    await repos.assets.get(id as AssetId);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("missing file");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(`file too large (max ${MAX_UPLOAD_BYTES} bytes)`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await repos.assets.addBlob(bytes);
    const updated = await repos.assets.update(id as AssetId, {
      mime: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      sha256,
    });
    return jsonOk(updated);
  } catch (err) {
    return handleErr(err);
  }
}

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
