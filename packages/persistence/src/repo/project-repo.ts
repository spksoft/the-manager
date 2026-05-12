import { NotFoundError, type ProjectId } from "@the-manager/shared";
import { paths } from "../paths";
import { type ProjectRow, ProjectsIndexSchema } from "../schemas";
import { JsonStore } from "../store";

export class ProjectRepo {
  private readonly store = new JsonStore(paths.projectsIndex(), ProjectsIndexSchema, () => ({
    version: 1 as const,
    data: [],
  }));

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
}
