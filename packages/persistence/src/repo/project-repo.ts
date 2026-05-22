import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { paths } from "../paths";
import { type ProjectRow, ProjectsIndexSchema } from "../schemas";
import { JsonStore } from "../store";

/**
 * v1 → v2 stamps `ephemeral: false` and `expiresAt: null` on every row.
 * v2 → v3 stamps `description: null` so older rows pick up auto-generation on
 * next manual regenerate (we don't kick it off here — that would mean firing
 * background claude calls for every legacy row at startup).
 * v3 → v4 stamps `tags: []` so the field is always present and consumers
 * don't have to null-check.
 */
function projectsMigrate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const file = raw as { version?: number; data?: unknown };
  let { version, data } = file;
  if (version === 4) return raw;
  if (version !== 1 && version !== 2 && version !== 3) return raw;
  const rows = Array.isArray(data) ? data : [];
  if (version === 1) {
    data = rows.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        ...r,
        ephemeral: r.ephemeral ?? false,
        expiresAt: r.expiresAt ?? null,
      };
    });
    version = 2;
  }
  if (version === 2) {
    data = (data as unknown[]).map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        ...r,
        description: r.description ?? null,
      };
    });
    version = 3;
  }
  return {
    version: 4,
    data: (data as unknown[]).map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        ...r,
        tags: Array.isArray(r.tags) ? r.tags : [],
      };
    }),
  };
}

export class ProjectRepo {
  private readonly store = new JsonStore(
    paths.projectsIndex(),
    ProjectsIndexSchema,
    () => ({
      version: 4 as const,
      data: [],
    }),
    projectsMigrate,
  );

  async list(): Promise<ProjectRow[]> {
    const file = await this.store.load();
    return file.data;
  }

  async get(id: ProjectId): Promise<ProjectRow> {
    const all = await this.list();
    const hit = all.find((p) => p.id === id);
    if (!hit) throw new NotFoundError("Project", id);
    return hit;
  }

  async add(project: ProjectRow): Promise<ProjectRow> {
    await this.store.update((file) => ({
      ...file,
      data: [...file.data.filter((p) => p.id !== project.id), project],
    }));
    return project;
  }

  /**
   * Partial update. Throws `NotFoundError` if no row matches. The API layer is
   * responsible for whitelisting which fields a given route is allowed to
   * change (today: name, defaultDriver, path).
   */
  async update(
    id: ProjectId,
    patch: Partial<Pick<ProjectRow, "name" | "defaultDriver" | "path" | "description" | "tags">>,
  ): Promise<ProjectRow> {
    let result: ProjectRow | null = null;
    await this.store.update((file) => {
      const row = file.data.find((p) => p.id === id);
      if (!row) return file;
      const next: ProjectRow = { ...row, ...patch };
      result = next;
      return {
        ...file,
        data: file.data.map((p) => (p.id === id ? next : p)),
      };
    });
    if (!result) throw new NotFoundError("Project", id);
    return result;
  }

  async remove(id: ProjectId): Promise<void> {
    await this.store.update((file) => ({
      ...file,
      data: file.data.filter((p) => p.id !== id),
    }));
  }

  async touchLastUsed(id: ProjectId, at = new Date().toISOString()): Promise<void> {
    await this.store.update((file) => ({
      ...file,
      data: file.data.map((p) => (p.id === id ? { ...p, lastUsedAt: at } : p)),
    }));
  }

  /** Ephemeral rows whose `expiresAt` has passed. Used by the TTL sweeper. */
  async listEphemeralExpired(now: Date = new Date()): Promise<ProjectRow[]> {
    const all = await this.list();
    const nowMs = now.getTime();
    return all.filter(
      (p) => p.ephemeral && p.expiresAt !== null && Date.parse(p.expiresAt) <= nowMs,
    );
  }

  /** All ephemeral rows, regardless of expiry. Used by the on-restart sweep. */
  async listEphemeral(): Promise<ProjectRow[]> {
    const all = await this.list();
    return all.filter((p) => p.ephemeral);
  }
}
