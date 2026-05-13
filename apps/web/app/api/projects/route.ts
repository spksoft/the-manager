import "server-only";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { paths } from "@the-manager/persistence";
import { type DriverId, newId, ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../lib/api";
import { repos } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  path: z.string().min(1),
  defaultDriver: z.enum(["claude", "codex", "gemini"]),
  ephemeral: z.boolean().optional(),
});

/** 24 hours, in milliseconds. Ephemeral projects get auto-destroyed past this. */
const EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    return jsonOk(await repos.projects.list());
  } catch (err) {
    return handleErr(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await parseJson(req, CreateBody);
    if (!isAbsolute(body.path)) throw new ValidationError("path must be absolute");
    const ephemeral = body.ephemeral === true;
    const tempRoot = paths.tempProjectsRoot();
    const insideTempRoot =
      body.path === tempRoot ||
      body.path.startsWith(`${tempRoot}/`) ||
      body.path.startsWith(`${tempRoot}\\`);

    // For ephemeral projects under the temp root we mkdir on demand — the
    // Manager picks a fresh /<uuid>/ dir that doesn't exist yet. For every
    // other case (including ephemeral=true pointing somewhere else), the
    // directory must already exist, same as before.
    if (ephemeral && insideTempRoot) {
      await mkdir(body.path, { recursive: true });
    } else {
      try {
        const s = await stat(body.path);
        if (!s.isDirectory()) throw new ValidationError("path is not a directory");
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(`path does not exist or is not readable: ${body.path}`);
      }
    }

    const now = new Date();
    const id = newId.project();
    const project = await repos.projects.add({
      id,
      name: body.name,
      path: body.path,
      defaultDriver: body.defaultDriver as DriverId,
      createdAt: now.toISOString(),
      lastUsedAt: null,
      ephemeral,
      expiresAt: ephemeral ? new Date(now.getTime() + EPHEMERAL_TTL_MS).toISOString() : null,
    });
    return jsonOk(project, { status: 201 });
  } catch (err) {
    return handleErr(err);
  }
}
