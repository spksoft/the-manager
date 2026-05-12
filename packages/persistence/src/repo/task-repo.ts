import { NotFoundError, type TaskId } from "@the-manager/shared";
import { paths } from "../paths";
import { type TaskRow, TasksIndexSchema } from "../schemas";
import { JsonStore } from "../store";

export class TaskRepo {
  private readonly store = new JsonStore(paths.tasksIndex(), TasksIndexSchema, () => ({
    version: 1 as const,
    data: [],
  }));

  async list(): Promise<TaskRow[]> {
    const file = await this.store.load();
    return file.data;
  }

  async get(id: TaskId): Promise<TaskRow> {
    const all = await this.list();
    const hit = all.find((t) => t.id === id);
    if (!hit) throw new NotFoundError("Task", id);
    return hit;
  }

  async upsert(task: TaskRow): Promise<TaskRow> {
    await this.store.update((file) => ({
      ...file,
      data: [...file.data.filter((t) => t.id !== task.id), task],
    }));
    return task;
  }

  async remove(id: TaskId): Promise<void> {
    await this.store.update((file) => ({
      ...file,
      data: file.data.filter((t) => t.id !== id),
    }));
  }
}
