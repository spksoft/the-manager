import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { paths } from "./paths";

/**
 * Long-term memory the Manager keeps in `~/.the-manager/manager/memory/`.
 * Two scopes:
 *
 *   - "global"          → `global.md`
 *   - { projectId }     → `projects/<id>.md`
 *
 * Markdown files, not JSON: the user can open them in the Manager's Files
 * tab and edit by hand. Writes go through `write-file-atomic` + `proper-lockfile`
 * so concurrent Manager appends and a user editing the same file can't
 * silently clobber each other.
 *
 * No memory file is ever written into a user project directory. If the user
 * unregisters a project, the per-project memory file becomes orphan; it sits
 * harmlessly under the Manager's storage root until cleaned up.
 */

export type MemoryScope = "global" | { projectId: string };

export interface MemoryReadResult {
  scope: MemoryScope;
  exists: boolean;
  content: string;
  sizeBytes: number;
  mtime: string | null;
}

export interface MemoryWriteResult {
  scope: MemoryScope;
  sizeBytes: number;
  mtime: string;
}

export interface MemoryScopeSummary {
  scope: MemoryScope;
  exists: boolean;
  sizeBytes: number;
  mtime: string | null;
}

export interface MemoryListResult {
  global: MemoryScopeSummary;
  projects: MemoryScopeSummary[];
}

function scopeFile(scope: MemoryScope): string {
  if (scope === "global") return paths.managerGlobalMemoryFile();
  return paths.managerProjectMemoryFile(scope.projectId);
}

async function readIfExists(filePath: string): Promise<{ content: string; mtime: Date } | null> {
  try {
    const [content, s] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return { content, mtime: s.mtime };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readMemory(scope: MemoryScope): Promise<MemoryReadResult> {
  const filePath = scopeFile(scope);
  const found = await readIfExists(filePath);
  if (!found) {
    return { scope, exists: false, content: "", sizeBytes: 0, mtime: null };
  }
  return {
    scope,
    exists: true,
    content: found.content,
    sizeBytes: Buffer.byteLength(found.content, "utf8"),
    mtime: found.mtime.toISOString(),
  };
}

async function writeUnderLock(
  filePath: string,
  next: string,
): Promise<{ sizeBytes: number; mtime: string }> {
  await mkdir(dirname(filePath), { recursive: true });
  // proper-lockfile needs the file to exist before locking it.
  try {
    await stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await writeFileAtomic(filePath, "", "utf8");
    } else {
      throw err;
    }
  }
  const release = await lock(filePath, {
    retries: { retries: 10, minTimeout: 25, maxTimeout: 250 },
    stale: 10_000,
  });
  try {
    await writeFileAtomic(filePath, next, "utf8");
    const s = await stat(filePath);
    return { sizeBytes: s.size, mtime: s.mtime.toISOString() };
  } finally {
    await release();
  }
}

export async function writeMemory(scope: MemoryScope, content: string): Promise<MemoryWriteResult> {
  const filePath = scopeFile(scope);
  const { sizeBytes, mtime } = await writeUnderLock(filePath, content);
  return { scope, sizeBytes, mtime };
}

export async function appendMemory(
  scope: MemoryScope,
  text: string,
  heading?: string,
): Promise<MemoryWriteResult> {
  const filePath = scopeFile(scope);
  await mkdir(dirname(filePath), { recursive: true });
  // Same bootstrap-then-lock dance as writeUnderLock — but we need the
  // current contents inside the lock so read+append+write is atomic.
  try {
    await stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await writeFileAtomic(filePath, "", "utf8");
    } else {
      throw err;
    }
  }
  const release = await lock(filePath, {
    retries: { retries: 10, minTimeout: 25, maxTimeout: 250 },
    stale: 10_000,
  });
  try {
    const existing = await readFile(filePath, "utf8");
    const now = new Date().toISOString();
    const headingBlock = heading ? `\n\n## ${heading}\n_${now}_\n` : `\n\n_${now}_\n`;
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const next = `${existing}${separator}${headingBlock}\n${text.trim()}\n`;
    await writeFileAtomic(filePath, next, "utf8");
    const s = await stat(filePath);
    return { scope, sizeBytes: s.size, mtime: s.mtime.toISOString() };
  } finally {
    await release();
  }
}

async function summarise(scope: MemoryScope): Promise<MemoryScopeSummary> {
  const filePath = scopeFile(scope);
  try {
    const s = await stat(filePath);
    return { scope, exists: true, sizeBytes: s.size, mtime: s.mtime.toISOString() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { scope, exists: false, sizeBytes: 0, mtime: null };
    }
    throw err;
  }
}

/**
 * `projectIds` is the live registry — we only summarise project scopes for
 * projects that still exist, even if older memory files are still on disk.
 * Stale files surface implicitly via the missing summaries and can be cleaned
 * up by a future sweep.
 */
export async function listMemoryScopes(projectIds: string[]): Promise<MemoryListResult> {
  const global = await summarise("global");
  const projects = await Promise.all(projectIds.map((id) => summarise({ projectId: id })));
  return { global, projects };
}
