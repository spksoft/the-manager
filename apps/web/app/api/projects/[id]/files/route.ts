import "server-only";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectId } from "@the-manager/shared";
import { ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../../lib/api";
import { repos } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IGNORED = new Set(["node_modules", ".git", ".next", ".turbo", "dist", ".DS_Store", ".cache"]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

/**
 * Resolve a project-relative path safely. Throws if the result escapes the
 * project root (path-traversal protection). Returns the absolute filesystem
 * path on success.
 */
function safeResolve(projectRoot: string, relPath: string): string {
  if (isAbsolute(relPath)) throw new ValidationError("path must be relative to the project");
  const abs = resolve(projectRoot, relPath);
  const rel = relative(projectRoot, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new ValidationError("path escapes the project root");
  }
  return abs;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const relPath = url.searchParams.get("path") ?? "";
    const project = await repos.projects.get(id as ProjectId);
    const abs = safeResolve(project.path, relPath);
    const s = await stat(abs);
    if (s.isDirectory()) {
      const entries = await readdir(abs, { withFileTypes: true });
      const out = entries
        .filter((e) => !IGNORED.has(e.name))
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
          path: join(relPath, e.name),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return jsonOk({ type: "dir", path: relPath, entries: out });
    }
    if (s.size > MAX_FILE_BYTES) {
      throw new ValidationError(`file is too large (${s.size} bytes; cap is ${MAX_FILE_BYTES})`);
    }
    const content = await readFile(abs, "utf8");
    return jsonOk({
      type: "file",
      path: relPath,
      content,
      sizeBytes: s.size,
      mtime: s.mtime.toISOString(),
    });
  } catch (err) {
    return handleErr(err);
  }
}

const PutBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** Last-known mtime (from GET). If present, server refuses to overwrite a newer disk version. */
  mtime: z.string().datetime().optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, PutBody);
    const project = await repos.projects.get(id as ProjectId);
    const abs = safeResolve(project.path, body.path);
    if (body.mtime) {
      try {
        const s = await stat(abs);
        if (s.mtime.toISOString() !== body.mtime) {
          return new Response(
            JSON.stringify({
              error: "STALE",
              message: "file changed on disk; refresh before saving",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
      } catch {
        // File didn't exist before — treat as create.
      }
    }
    await writeFile(abs, body.content, "utf8");
    const s = await stat(abs);
    return jsonOk({ ok: true, sizeBytes: s.size, mtime: s.mtime.toISOString() });
  } catch (err) {
    return handleErr(err);
  }
}
