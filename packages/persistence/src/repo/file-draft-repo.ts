import { paths } from "../paths";
import { type FileDraftRow, type FileDraftsFile, FileDraftsSchema } from "../schemas";
import { JsonStore } from "../store";

function key(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

/**
 * In-flight editor drafts that haven't been saved to disk yet. Keyed by
 * `${projectId}:${path}` because paths can collide across projects.
 *
 * Cleared automatically when:
 *   - the user saves the file (caller invokes `remove`),
 *   - the on-disk mtime no longer matches the draft's `baseMtime` (caller
 *     decides; this repo just stores the value),
 *   - a project is removed (`forgetProject`).
 */
export class FileDraftRepo {
  private readonly store = new JsonStore<FileDraftsFile>(
    paths.fileDrafts(),
    FileDraftsSchema,
    () => ({ version: 1 as const, drafts: {} }),
  );

  async get(projectId: string, path: string): Promise<FileDraftRow | null> {
    const file = await this.store.load();
    return file.drafts[key(projectId, path)] ?? null;
  }

  async put(
    projectId: string,
    path: string,
    draft: Omit<FileDraftRow, "updatedAt">,
  ): Promise<FileDraftRow> {
    const row: FileDraftRow = { ...draft, updatedAt: new Date().toISOString() };
    await this.store.update((file) => ({
      ...file,
      drafts: { ...file.drafts, [key(projectId, path)]: row },
    }));
    return row;
  }

  async remove(projectId: string, path: string): Promise<void> {
    await this.store.update((file) => {
      const k = key(projectId, path);
      if (!(k in file.drafts)) return file;
      const { [k]: _gone, ...rest } = file.drafts;
      return { ...file, drafts: rest };
    });
  }

  async forgetProject(projectId: string): Promise<void> {
    const prefix = `${projectId}:`;
    await this.store.update((file) => {
      const entries = Object.entries(file.drafts).filter(([k]) => !k.startsWith(prefix));
      if (entries.length === Object.keys(file.drafts).length) return file;
      return { ...file, drafts: Object.fromEntries(entries) };
    });
  }
}
