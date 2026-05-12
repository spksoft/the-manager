import "server-only";
import { newId, ValidationError } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../lib/api";
import { repos } from "../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export async function GET() {
  try {
    return jsonOk(await repos.assets.list());
  } catch (err) {
    return handleErr(err);
  }
}

/**
 * Multipart upload: form fields `file` (required), `scope` ("global" or a
 * project id), `tags` (comma-separated, optional). Stores the blob
 * content-addressed by sha256 and the metadata in the assets index.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("missing file");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(`file too large (max ${MAX_UPLOAD_BYTES} bytes)`);
    }
    const scopeRaw = form.get("scope");
    const tagsRaw = form.get("tags");
    const folderRaw = form.get("folder");
    let scope: { projectId: string } | "global" = "global";
    if (typeof scopeRaw === "string" && scopeRaw && scopeRaw !== "global") {
      scope = { projectId: scopeRaw };
    }
    const tags =
      typeof tagsRaw === "string" && tagsRaw.length > 0
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    const folder = typeof folderRaw === "string" && folderRaw.length > 0 ? folderRaw : null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await repos.assets.addBlob(bytes);
    const id = newId.asset();
    const asset = await repos.assets.upsert({
      id,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      sha256,
      scope,
      tags,
      folder,
      createdAt: new Date().toISOString(),
    });
    return jsonOk(asset, { status: 201 });
  } catch (err) {
    return handleErr(err);
  }
}
