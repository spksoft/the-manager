import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AssetId, NotFoundError, ValidationError } from "@the-manager/shared";
import { paths } from "../paths";
import { type AssetRow, AssetsIndexSchema } from "../schemas";
import { JsonStore } from "../store";

/**
 * Migrate an on-disk v1 assets file (no per-row `folder`, no top-level
 * `folders`) into the v2 shape. Runs once per cold load via the JsonStore
 * migrate hook so the rest of the repo only ever sees v2.
 */
function migrateAssetsFile(raw: unknown): unknown {
  if (raw && typeof raw === "object" && (raw as { version?: number }).version === 1) {
    const v1 = raw as { version: 1; data: Array<Record<string, unknown>> };
    return {
      version: 2,
      data: v1.data.map((row) => ({ ...row, folder: null })),
      folders: [],
    };
  }
  return raw;
}

/**
 * Assets are content-addressed by sha256. The blob bytes live on disk at
 * `<root>/assets/blobs/<sha256>`; the index file stores only metadata.
 *
 * Replacing a blob writes a fresh content-addressed file and leaves the old
 * one orphaned. Explicit GC is intentionally out of scope; if it ever becomes
 * a problem, a background sweep can collect blobs not referenced by any row.
 */
export class AssetRepo {
  private readonly store = new JsonStore(
    paths.assetsIndex(),
    AssetsIndexSchema,
    () => ({ version: 2 as const, data: [], folders: [] }),
    migrateAssetsFile,
  );

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

  /**
   * Apply a partial patch to an existing asset. Throws `NotFoundError` if no
   * row matches. The API layer is responsible for whitelisting which fields a
   * given route is allowed to change.
   */
  async update(
    id: AssetId,
    patch: Partial<
      Pick<AssetRow, "filename" | "tags" | "scope" | "folder" | "mime" | "sizeBytes" | "sha256">
    >,
  ): Promise<AssetRow> {
    let result: AssetRow | null = null;
    await this.store.update((file) => {
      const row = file.data.find((a) => a.id === id);
      if (!row) return file;
      const next: AssetRow = { ...row, ...patch };
      result = next;
      return {
        ...file,
        data: file.data.map((a) => (a.id === id ? next : a)),
      };
    });
    if (!result) throw new NotFoundError("Asset", id);
    return result;
  }

  async remove(id: AssetId): Promise<void> {
    await this.store.update((file) => ({
      ...file,
      data: file.data.filter((a) => a.id !== id),
    }));
  }

  /** Distinct folder names: union of values on rows and persisted empty folders. */
  async listFolders(): Promise<string[]> {
    const file = await this.store.load();
    const set = new Set<string>(file.folders);
    for (const row of file.data) {
      if (row.folder) set.add(row.folder);
    }
    return [...set].sort();
  }

  /** Persist an otherwise-empty folder so it shows up in the browser. No-op if it already exists. */
  async addFolder(folder: string): Promise<void> {
    await this.store.update((file) => {
      if (file.folders.includes(folder)) return file;
      return { ...file, folders: [...file.folders, folder] };
    });
  }

  /** Refuses to remove a folder while any asset references it; clients must move/delete those first. */
  async removeFolder(folder: string): Promise<void> {
    const file = await this.store.load();
    const inUse = file.data.some((a) => a.folder === folder);
    if (inUse) {
      throw new ValidationError(
        `cannot remove folder "${folder}": still contains assets — move or delete them first`,
      );
    }
    await this.store.update((current) => ({
      ...current,
      folders: current.folders.filter((f) => f !== folder),
    }));
  }
}
