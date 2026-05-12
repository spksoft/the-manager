import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import type { z } from "zod";

/**
 * Generic JSON file store. One instance per file path.
 *
 * Safety guarantees:
 *   - Reads parse through a Zod schema; corrupt files surface as a parse error
 *     rather than silently returning broken data.
 *   - Writes go through `write-file-atomic` (write `*.tmp` -> fsync -> rename),
 *     so a crash mid-write leaves either the old or new file intact, never a
 *     truncated one.
 *   - Multi-process writes are serialized through `proper-lockfile`. The
 *     Electron main process and a co-running self-hosted Next.js server can
 *     therefore share the same files without corruption.
 *   - An in-memory cache is held until `save()` invalidates it; `load()` reads
 *     from disk on cache miss only.
 *
 * Pass a `defaultValue` factory so the file is materialized on first use
 * without callers having to special-case "file does not exist yet".
 */
export class JsonStore<T> {
  private cache: T | null = null;
  private loadPromise: Promise<T> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    private readonly defaultValue: () => T,
  ) {}

  /** Read + parse. Returns the cached value on subsequent calls. */
  async load(): Promise<T> {
    if (this.cache !== null) return this.cache;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.#loadFromDisk();
    try {
      this.cache = await this.loadPromise;
      return this.cache;
    } finally {
      this.loadPromise = null;
    }
  }

  async #loadFromDisk(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if (isNodeENOENT(err)) {
        const fallback = this.defaultValue();
        await this.#writeRaw(fallback);
        return fallback;
      }
      throw err;
    }
    return this.schema.parse(JSON.parse(raw));
  }

  /**
   * Atomic write under a file lock. The updater receives the current value and
   * returns the next value; it MUST be pure (no I/O), since the lock is held
   * for the duration of the call.
   */
  async update(updater: (current: T) => T): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // proper-lockfile requires the file to exist; ensure it via load().
    await this.load();
    const release = await lock(this.filePath, {
      retries: { retries: 10, minTimeout: 25, maxTimeout: 250 },
      stale: 10_000,
    });
    try {
      const current = await this.#loadFromDisk();
      const next = updater(current);
      await this.#writeRaw(next);
      this.cache = next;
      return next;
    } finally {
      await release();
    }
  }

  /** Replace the entire file. Prefer `update()` when you only need to mutate a slice. */
  async save(value: T): Promise<void> {
    await this.update(() => value);
  }

  async #writeRaw(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const validated = this.schema.parse(value);
    const serialized = `${JSON.stringify(validated, null, 2)}\n`;
    await writeFileAtomic(this.filePath, serialized, "utf8");
  }
}

function isNodeENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
