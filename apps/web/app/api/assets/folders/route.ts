import "server-only";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";
import { repos } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Folder collection for assets. Folders are a flat namespace of path-like
 * strings (e.g. "images/2024"). They can exist independently of any asset so
 * the UI can create empty folders and drop uploads into them.
 */

export async function GET() {
  try {
    return jsonOk({ folders: await repos.assets.listFolders() });
  } catch (err) {
    return handleErr(err);
  }
}

const FolderBody = z.object({ folder: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { folder } = await parseJson(req, FolderBody);
    await repos.assets.addFolder(folder);
    return jsonOk({ ok: true, folder }, { status: 201 });
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const { folder } = await parseJson(req, FolderBody);
    await repos.assets.removeFolder(folder);
    return jsonOk({ ok: true, folder });
  } catch (err) {
    return handleErr(err);
  }
}
