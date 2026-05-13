import "server-only";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { ValidationError } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  ".cache",
  ".DS_Store",
]);

/**
 * Folder browser used by the web-surface project-path picker. The desktop
 * surface uses the native OS dialog via the Electron bridge; web hits this
 * endpoint to walk the local filesystem (the Next server runs on the same
 * machine as the user).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("path");
    const home = homedir();
    const target = raw && raw.length > 0 ? resolve(raw) : home;
    if (!isAbsolute(target)) {
      throw new ValidationError("path must be absolute");
    }

    const dirents = await readdir(target, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory() && !IGNORED_DIRS.has(d.name) && !d.name.startsWith("."))
      .map((d) => ({ name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = dirname(target);
    return jsonOk({
      path: target,
      parent: parent === target ? null : parent,
      home,
      entries,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return handleErr(new ValidationError("directory does not exist"));
    }
    if ((err as NodeJS.ErrnoException).code === "ENOTDIR") {
      return handleErr(new ValidationError("path is not a directory"));
    }
    if ((err as NodeJS.ErrnoException).code === "EACCES") {
      return handleErr(new ValidationError("permission denied"));
    }
    return handleErr(err);
  }
}
