/**
 * Versioned migrate-on-read. Every JSON index file stores `{ version, data }`;
 * when we bump a shape, we register a migrator here that upgrades the previous
 * shape in-place at load time.
 *
 * Phase 0: nothing to migrate yet — version 1 is the only shape.
 */

export type Migrator<T> = (prev: unknown) => T;

export interface MigrationChain<T> {
  /** The current (latest) version. */
  currentVersion: number;
  /** Map of `from -> to` upgraders (e.g. `1 -> 2`). Composed in sequence. */
  steps: Record<number, (prev: unknown) => unknown>;
  /** Parse the fully-upgraded shape (typically zod's `.parse`). */
  parse: Migrator<T>;
}

export function migrate<T>(raw: unknown, chain: MigrationChain<T>): T {
  let cursor = raw as { version?: number; data?: unknown } | undefined;
  if (!cursor || typeof cursor !== "object") {
    throw new Error("migrate: input is not an object");
  }
  let version = cursor.version ?? 1;
  while (version < chain.currentVersion) {
    const step = chain.steps[version];
    if (!step) {
      throw new Error(`migrate: no migrator registered for version ${version} -> ${version + 1}`);
    }
    cursor = step(cursor) as { version?: number; data?: unknown };
    version += 1;
  }
  return chain.parse(cursor);
}
