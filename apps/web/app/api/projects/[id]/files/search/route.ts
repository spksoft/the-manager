import "server-only";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ProjectId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../../lib/api";
import { resolveProjectCwd } from "../../../../../../lib/cwd";
import { isProbablyBinary, walkProject } from "../../../../../../lib/project-fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RESULTS = 100;
const MAX_MATCHES_PER_FILE = 3;
const SNIPPET_RADIUS = 40;

interface SearchMatch {
  line: number;
  col: number;
  preview: string;
}

interface SearchResult {
  path: string;
  type: "file";
  score: number;
  matches?: SearchMatch[];
}

/**
 * Subsequence-aware name match. Returns a normalized score in [0,1] or null
 * if the query characters don't appear in order in the haystack.
 *
 * Scoring favors:
 *   - exact basename hits
 *   - matches in the basename over matches in the directory portion
 *   - prefix matches over interior matches
 *   - shallow paths over deep ones
 */
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
  for (let i = 0; i < lines.length && out.length < MAX_MATCHES_PER_FILE; i++) {
    const line = lines[i] ?? "";
    const lower = line.toLowerCase();
    const col = lower.indexOf(needle);
    if (col === -1) continue;
    const start = Math.max(0, col - SNIPPET_RADIUS);
    const end = Math.min(line.length, col + needle.length + SNIPPET_RADIUS);
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const mode = url.searchParams.get("mode") === "content" ? "content" : "name";
    if (q.length < 2) {
      return jsonOk({ results: [], truncated: false });
    }
    const root = await resolveProjectCwd(id as ProjectId);
    const { files, truncated: walkTruncated } = await walkProject(root, {
      maxFiles: 5000,
      budgetMs: 1500,
    });

    let truncated = walkTruncated;
    const results: SearchResult[] = [];

    if (mode === "name") {
      for (const f of files) {
        const score = scoreName(f.path, q);
        if (score === null) continue;
        results.push({ path: f.path, type: "file", score });
        if (results.length >= MAX_RESULTS * 4) break;
      }
      results.sort((a, b) => b.score - a.score);
      results.length = Math.min(results.length, MAX_RESULTS);
    } else {
      const start = Date.now();
      for (const f of files) {
        if (results.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        if (Date.now() - start > 1500) {
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
        const matches = findContentMatches(content, q);
        if (matches.length === 0) continue;
        const firstLine = matches[0]?.line ?? 1;
        results.push({
          path: f.path,
          type: "file",
          score: 1 - firstLine / 10000,
          matches,
        });
      }
    }

    return jsonOk({ results, truncated });
  } catch (err) {
    return handleErr(err);
  }
}
