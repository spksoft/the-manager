import "server-only";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectId } from "@the-manager/shared";
import { ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonErr, jsonOk, parseJson } from "../../../../../lib/api";
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

const PostBody = z.object({
  path: z.string().min(1),
  kind: z.literal("dir"),
});

/** Create a new empty directory. File creation continues to use `PUT` with empty content. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, PostBody);
    const project = await repos.projects.get(id as ProjectId);
    const abs = safeResolve(project.path, body.path);
    try {
      await mkdir(abs, { recursive: false });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST")
        return jsonErr(409, "EXISTS", `directory already exists: ${body.path}`);
      throw err;
    }
    return jsonOk({ ok: true, path: body.path });
  } catch (err) {
    return handleErr(err);
  }
}

const DeleteBody = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
});

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, DeleteBody);
    const project = await repos.projects.get(id as ProjectId);
    const abs = safeResolve(project.path, body.path);
    const s = await stat(abs);
    if (s.isDirectory() && !body.recursive) {
      throw new ValidationError(`refusing to delete a directory without recursive: true`);
    }
    await rm(abs, { recursive: Boolean(body.recursive), force: false });
    return jsonOk({ ok: true, path: body.path });
  } catch (err) {
    return handleErr(err);
  }
}

const PatchBody = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

/** Rename or move a file/directory inside the project root. Both paths flow through safeResolve. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseJson(req, PatchBody);
    const project = await repos.projects.get(id as ProjectId);
    const absFrom = safeResolve(project.path, body.from);
    const absTo = safeResolve(project.path, body.to);
    try {
      await stat(absTo);
      return jsonErr(409, "EXISTS", `destination already exists: ${body.to}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await rename(absFrom, absTo);
    return jsonOk({ ok: true, from: body.from, to: body.to });
  } catch (err) {
    return handleErr(err);
  }
}
