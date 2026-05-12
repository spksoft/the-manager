import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AssetId, NotFoundError } from "@the-manager/shared";
import { paths } from "../paths";
import { type AssetRow, AssetsIndexSchema } from "../schemas";
import { JsonStore } from "../store";

/**
 * Assets are content-addressed by sha256. The blob bytes live on disk at
 * `<root>/assets/blobs/<sha256>`; the index file stores only metadata.
 */
export class AssetRepo {
  private readonly store = new JsonStore(paths.assetsIndex(), AssetsIndexSchema, () => ({
    version: 1 as const,
    data: [],
  }));

  async list(): Promise<AssetRow[]> {
    const file = await this.store.load();
    return file.data;
  }

  async get(id: AssetId): Promise<AssetRow> {
    const all = await this.list();
    const hit = all.find((a) => a.id === id);
    if (!hit) throw new NotFoundError("Asset", id);
    return hit;
  }

  async addBlob(bytes: Uint8Array): Promise<string> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const blobPath = paths.assetBlob(sha256);
    await mkdir(dirname(blobPath), { recursive: true });
    await writeFile(blobPath, bytes);
    return sha256;
  }

  async upsert(asset: AssetRow): Promise<AssetRow> {
    await this.store.update((file) => ({
      ...file,
      data: [...file.data.filter((a) => a.id !== asset.id), asset],
    }));
    return asset;
  }

  async remove(id: AssetId): Promise<void> {
    await this.store.update((file) => ({
      ...file,
      data: file.data.filter((a) => a.id !== id),
    }));
  }
}
