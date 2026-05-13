import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ValidationError } from "@the-manager/shared";

/** Directories the file tree and search both skip. */
export const IGNORED = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  ".DS_Store",
  ".cache",
]);

/**
 * Resolve a project-relative path safely. Throws if the result escapes the
 * project root (path-traversal protection). Returns the absolute filesystem
 * path on success.
 */
export function safeResolve(projectRoot: string, relPath: string): string {
  if (isAbsolute(relPath)) throw new ValidationError("path must be relative to the project");
  const abs = resolve(projectRoot, relPath);
  const rel = relative(projectRoot, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new ValidationError("path escapes the project root");
  }
  return abs;
}

export interface WalkEntry {
  /** Project-relative path with forward slashes. */
  path: string;
  absPath: string;
  sizeBytes: number;
}

export interface WalkOptions {
  /** Hard cap on number of files visited. Default 5000. */
  maxFiles?: number;
  /** Wall-clock budget in ms. Default 1500. */
  budgetMs?: number;
  /** Skip files larger than this. Default 1 MB. */
  maxFileBytes?: number;
}

export interface WalkResult {
  files: WalkEntry[];
  truncated: boolean;
}

/**
 * Breadth-first walk of the project tree, honoring IGNORED and the caps in
 * WalkOptions. Symlink loops aren't a concern because readdir doesn't follow
 * them and safeResolve already rejects out-of-root absolute paths.
 */
export async function walkProject(
  projectRoot: string,
  options: WalkOptions = {},
): Promise<WalkResult> {
  const maxFiles = options.maxFiles ?? 5000;
  const budgetMs = options.budgetMs ?? 1500;
  const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
  const start = Date.now();
  const files: WalkEntry[] = [];
  const queue: string[] = [""];
  let truncated = false;

  while (queue.length > 0) {
    if (Date.now() - start > budgetMs) {
      truncated = true;
      break;
    }
    const relDir = queue.shift() ?? "";
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(join(projectRoot, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        queue.push(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const abs = join(projectRoot, relPath);
      let size = 0;
      try {
        const s = await stat(abs);
        size = s.size;
      } catch {
        continue;
      }
      if (size > maxFileBytes) continue;
      files.push({ path: relPath, absPath: abs, sizeBytes: size });
      if (files.length >= maxFiles) {
        truncated = true;
        return { files, truncated };
      }
    }
  }

  return { files, truncated };
}

/**
 * Heuristic binary sniff — reads the first chunk and checks for a NUL byte.
 * Cheap and good enough to skip binary blobs in content search.
 */
export async function isProbablyBinary(absPath: string, sampleBytes = 8192): Promise<boolean> {
  try {
    const fh = await readFile(absPath);
    const sample = fh.subarray(0, Math.min(sampleBytes, fh.byteLength));
    for (let i = 0; i < sample.byteLength; i++) {
      if (sample[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}
