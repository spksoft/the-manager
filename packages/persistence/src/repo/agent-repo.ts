import { NotFoundError, type ProjectId, type SessionId } from "@the-manager/shared";
import { paths } from "../paths";
import { type SessionRow, SessionsIndexSchema } from "../schemas";
import { JsonStore } from "../store";

/** One index file per project. AgentRepo lazily creates stores as projects are touched. */
export class AgentRepo {
  private readonly stores = new Map<ProjectId, JsonStore<{ version: 1; data: SessionRow[] }>>();

  private storeFor(projectId: ProjectId) {
    let s = this.stores.get(projectId);
    if (!s) {
      s = new JsonStore(paths.sessionsIndex(projectId), SessionsIndexSchema, () => ({
        version: 1 as const,
        data: [],
      }));
      this.stores.set(projectId, s);
    }
    return s;
  }

  async listByProject(projectId: ProjectId): Promise<SessionRow[]> {
    const file = await this.storeFor(projectId).load();
    return file.data;
  }

  async get(projectId: ProjectId, sessionId: SessionId): Promise<SessionRow> {
    const all = await this.listByProject(projectId);
    const hit = all.find((s) => s.id === sessionId);
    if (!hit) throw new NotFoundError("Session", sessionId);
    return hit;
  }

  async upsert(projectId: ProjectId, session: SessionRow): Promise<SessionRow> {
    await this.storeFor(projectId).update((file) => ({
      ...file,
      data: [...file.data.filter((s) => s.id !== session.id), session],
    }));
    return session;
  }

  async remove(projectId: ProjectId, sessionId: SessionId): Promise<void> {
    await this.storeFor(projectId).update((file) => ({
      ...file,
      data: file.data.filter((s) => s.id !== sessionId),
    }));
  }
}
