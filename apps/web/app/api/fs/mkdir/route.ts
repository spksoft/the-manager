import "server-only";
import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonErr, jsonOk, parseJson } from "../../../../lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  parent: z.string().min(1),
  name: z.string().min(1).max(255),
});

/**
 * Create a new directory under `parent`. Used by the web-surface folder picker
 * so users can mkdir without leaving the dialog. Desktop uses the native OS
 * dialog which already supports this.
 */
export async function POST(req: Request) {
  try {
    const body = await parseJson(req, Body);
    const parent = resolve(body.parent);
    if (!isAbsolute(parent)) {
      throw new ValidationError("parent must be absolute");
    }
    const name = body.name.trim();
    if (name.length === 0 || name === "." || name === "..") {
      throw new ValidationError("invalid folder name");
    }
    if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
      throw new ValidationError("folder name must not contain path separators");
    }

    const target = resolve(parent, name);
    try {
      await mkdir(target, { recursive: false });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return jsonErr(409, "EXISTS", `already exists: ${name}`);
      if (code === "ENOENT") return jsonErr(400, "VALIDATION", "parent does not exist");
      if (code === "ENOTDIR") return jsonErr(400, "VALIDATION", "parent is not a directory");
      if (code === "EACCES") return jsonErr(400, "VALIDATION", "permission denied");
      throw err;
    }
    return jsonOk({ path: target });
  } catch (err) {
    return handleErr(err);
  }
}
