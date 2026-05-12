import "server-only";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type DriverId, newId, ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../lib/api";
import { repos } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  path: z.string().min(1),
  defaultDriver: z.enum(["claude", "codex", "gemini"]),
});

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
    try {
      const s = await stat(body.path);
      if (!s.isDirectory()) throw new ValidationError("path is not a directory");
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`path does not exist or is not readable: ${body.path}`);
    }
    const id = newId.project();
    const project = await repos.projects.add({
      id,
      name: body.name,
      path: body.path,
      defaultDriver: body.defaultDriver as DriverId,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    return jsonOk(project, { status: 201 });
  } catch (err) {
    return handleErr(err);
  }
}
