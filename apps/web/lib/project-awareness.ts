import "server-only";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { GitView } from "@the-manager/git";
import type { ProjectId } from "@the-manager/shared";
import { resolveProjectCwd } from "./cwd";
import { IGNORED, isProbablyBinary, safeResolve, walkProject } from "./project-fs";

/**
 * Read-only project introspection used by the Manager's MCP bridge. Each
 * function takes a `ProjectId`, resolves it to a cwd via `resolveProjectCwd`,
 * and returns a JSON-serialisable summary. Nothing in this module writes to
 * disk — it's deliberately a one-way mirror so the Manager can answer "what's
 * the state of project X" without paying the round-trip cost of asking the
 * project agent.
 */

// ── git ────────────────────────────────────────────────────────────────────

export interface GitStatusSummary {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Total dirty entries (staged + unstaged + untracked + conflicted). */
  dirty: number;
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
  conflicted: string[];
}

export async function getProjectGitStatus(projectId: ProjectId): Promise<GitStatusSummary> {
  const cwd = await resolveProjectCwd(projectId);
  const view = new GitView(cwd);
  if (!(await view.isRepository())) {
    return {
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: 0,
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
      conflicted: [],
    };
  }
  const [branch, status] = await Promise.all([
    view.currentBranch(),
    view.status().catch(() => null),
  ]);
  if (!status) {
    return {
      isRepo: true,
      branch,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: 0,
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
      conflicted: [],
    };
  }
  const staged = status.staged ?? [];
  const modified = status.modified ?? [];
  const untracked = status.not_added ?? [];
  const deleted = status.deleted ?? [];
  const conflicted = status.conflicted ?? [];
  return {
    isRepo: true,
    branch,
    upstream: status.tracking ?? null,
    ahead: status.ahead ?? 0,
    behind: status.behind ?? 0,
    dirty: staged.length + modified.length + untracked.length + deleted.length + conflicted.length,
    staged,
    modified,
    untracked,
    deleted,
    conflicted,
  };
}

export interface GitLogEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

export interface GitLogSummary {
  isRepo: boolean;
  branch: string | null;
  commits: GitLogEntry[];
}

export async function getProjectGitLog(
  projectId: ProjectId,
  limit: number,
): Promise<GitLogSummary> {
  const cwd = await resolveProjectCwd(projectId);
  const view = new GitView(cwd);
  if (!(await view.isRepository())) {
    return { isRepo: false, branch: null, commits: [] };
  }
  const [branch, log] = await Promise.all([
    view.currentBranch(),
    view.log(limit).catch(() => ({ all: [] as { hash: string; date: string; message: string; author_name: string }[] })),
  ]);
  return {
    isRepo: true,
    branch,
    commits: log.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      author: c.author_name,
      subject: c.message,
    })),
  };
}

// ── files ──────────────────────────────────────────────────────────────────

export interface FileTreeEntry {
  path: string;
  type: "file" | "dir";
  sizeBytes?: number;
}

export interface FileTreeResult {
  root: string;
  entries: FileTreeEntry[];
  truncated: boolean;
}

const FILE_TREE_HARD_CAP = 500;

/**
 * Shallow-then-recursive directory listing. Honors `IGNORED` from project-fs
 * and stops at `depth` levels under `subdir`. Output is sorted dirs-first,
 * then by name, with project-relative paths using forward slashes.
 */
export async function listProjectFiles(
  projectId: ProjectId,
  subdir: string,
  depth: number,
): Promise<FileTreeResult> {
  const root = await resolveProjectCwd(projectId);
  const startAbs = safeResolve(root, subdir);
  const entries: FileTreeEntry[] = [];
  let truncated = false;

  async function walk(absDir: string, relDir: string, remaining: number): Promise<void> {
    if (entries.length >= FILE_TREE_HARD_CAP) {
      truncated = true;
      return;
    }
    let dir: import("node:fs").Dirent[];
    try {
      dir = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = dir
      .filter((e) => !IGNORED.has(e.name))
      .sort((a, b) => {
        const aDir = a.isDirectory();
        const bDir = b.isDirectory();
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const e of sorted) {
      if (entries.length >= FILE_TREE_HARD_CAP) {
        truncated = true;
        return;
      }
      const relPath = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        entries.push({ path: relPath, type: "dir" });
        if (remaining > 0) {
          await walk(join(absDir, e.name), relPath, remaining - 1);
        }
      } else if (e.isFile()) {
        let sizeBytes: number | undefined;
        try {
          const s = await stat(join(absDir, e.name));
          sizeBytes = s.size;
        } catch {
          /* ignore — leave size unknown */
        }
        entries.push({ path: relPath, type: "file", sizeBytes });
      }
    }
  }

  await walk(startAbs, subdir, Math.max(0, depth));
  return { root: subdir || ".", entries, truncated };
}

export interface ReadFileResult {
  path: string;
  sizeBytes: number;
  mtime: string;
  content: string;
  truncated: boolean;
}

const READ_FILE_HARD_CAP = 256 * 1024;

export async function readProjectFile(
  projectId: ProjectId,
  relPath: string,
  maxBytes: number,
): Promise<ReadFileResult> {
  const root = await resolveProjectCwd(projectId);
  const abs = safeResolve(root, relPath);
  const s = await stat(abs);
  if (s.isDirectory()) {
    throw new Error(`path is a directory, not a file: ${relPath}`);
  }
  const cap = Math.min(maxBytes, READ_FILE_HARD_CAP);
  const raw = await readFile(abs);
  const truncated = raw.byteLength > cap;
  const slice = truncated ? raw.subarray(0, cap) : raw;
  return {
    path: relPath,
    sizeBytes: s.size,
    mtime: s.mtime.toISOString(),
    content: slice.toString("utf8"),
    truncated,
  };
}

// ── search ─────────────────────────────────────────────────────────────────

export interface SearchMatch {
  line: number;
  col: number;
  preview: string;
}

export interface SearchResult {
  path: string;
  score: number;
  matches?: SearchMatch[];
}

export interface SearchSummary {
  query: string;
  mode: "name" | "content";
  results: SearchResult[];
  truncated: boolean;
}

const SEARCH_MAX_RESULTS = 50;
const SEARCH_MAX_MATCHES_PER_FILE = 3;
const SEARCH_SNIPPET_RADIUS = 40;
const SEARCH_BUDGET_MS = 1500;

function scoreName(path: string, q: string): number | null {
  const hay = path.toLowerCase();
  const needle = q.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx === -1) {
    let qi = 0;
    for (let i = 0; i < hay.length && qi < needle.length; i++) {
      if (hay[i] === needle[qi]) qi++;
    }
    if (qi < needle.length) return null;
    return 0.2;
  }
  const name = basename(hay);
  const baseIdx = name.indexOf(needle);
  const depth = path.split("/").length;
  let score = 0.5;
  if (baseIdx !== -1) {
    score = baseIdx === 0 ? 0.95 : 0.8;
    if (name === needle) score = 1;
  } else if (idx === 0) {
    score = 0.6;
  }
  return Math.max(0, score - (depth - 1) * 0.02);
}

function findContentMatches(content: string, q: string): SearchMatch[] {
  const out: SearchMatch[] = [];
  const needle = q.toLowerCase();
  if (needle.length === 0) return out;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && out.length < SEARCH_MAX_MATCHES_PER_FILE; i++) {
    const line = lines[i] ?? "";
    const lower = line.toLowerCase();
    const col = lower.indexOf(needle);
    if (col === -1) continue;
    const start = Math.max(0, col - SEARCH_SNIPPET_RADIUS);
    const end = Math.min(line.length, col + needle.length + SEARCH_SNIPPET_RADIUS);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < line.length ? "…" : "";
    out.push({
      line: i + 1,
      col: col + 1,
      preview: `${prefix}${line.slice(start, end)}${suffix}`,
    });
  }
  return out;
}

export async function searchProject(
  projectId: ProjectId,
  query: string,
  mode: "name" | "content",
  limit: number,
): Promise<SearchSummary> {
  const cwd = await resolveProjectCwd(projectId);
  const { files, truncated: walkTruncated } = await walkProject(cwd, {
    maxFiles: 5000,
    budgetMs: SEARCH_BUDGET_MS,
  });
  const cap = Math.min(limit, SEARCH_MAX_RESULTS);
  let truncated = walkTruncated;
  const results: SearchResult[] = [];

  if (mode === "name") {
    for (const f of files) {
      const score = scoreName(f.path, query);
      if (score === null) continue;
      results.push({ path: f.path, score });
    }
    results.sort((a, b) => b.score - a.score);
    if (results.length > cap) {
      results.length = cap;
      truncated = true;
    }
  } else {
    const start = Date.now();
    for (const f of files) {
      if (results.length >= cap) {
        truncated = true;
        break;
      }
      if (Date.now() - start > SEARCH_BUDGET_MS) {
        truncated = true;
        break;
      }
      if (await isProbablyBinary(f.absPath)) continue;
      let content: string;
      try {
        content = await readFile(f.absPath, "utf8");
      } catch {
        continue;
      }
      const matches = findContentMatches(content, query);
      if (matches.length === 0) continue;
      const firstLine = matches[0]?.line ?? 1;
      results.push({ path: f.path, score: 1 - firstLine / 10000, matches });
    }
  }

  return { query, mode, results, truncated };
}
