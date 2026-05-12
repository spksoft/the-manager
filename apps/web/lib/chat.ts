import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { ClaudePromptDriver, type PromptEvent } from "@the-manager/drivers";
import { JsonStore, paths } from "@the-manager/persistence";
import { type ProjectId, type SessionId, ValidationError } from "@the-manager/shared";
import { z } from "zod";
import { MANAGER_PROJECT_ID, repos } from "./runtime";

/**
 * Chat layer for "Claude in print mode" — one conversation per project (and a
 * dedicated one for the Manager). Each user message becomes one `claude -p`
 * invocation that resumes the conversation by UUID. Conversation IDs are
 * persisted; the transcript of every sent / received event is appended to a
 * JSONL file so reloads can replay the conversation without round-tripping
 * Claude's own session storage.
 */

const ConversationsSchema = z.object({
  version: z.literal(1),
  /** projectId → conversationId (uuid). */
  data: z.record(z.string().uuid()),
});

type ConversationsFile = z.infer<typeof ConversationsSchema>;

function conversationsPath(): string {
  return join(paths.root(), "conversations.json");
}

const store = new JsonStore<ConversationsFile>(conversationsPath(), ConversationsSchema, () => ({
  version: 1,
  data: {},
}));

const driver = new ClaudePromptDriver();

/**
 * Per-projectId mutex. `claude` rejects a second `--resume <uuid>` invocation
 * against the same session id while the first is still running, so two clients
 * (or one impatient client) firing parallel prompts produce one broken
 * conversation. We serialize by chaining each new prompt onto the previous
 * promise for the same project.
 *
 * Lives on `globalThis` so Next.js dev hot-reload doesn't reset the lock and
 * orphan in-flight calls.
 */
const LOCK_KEY = "__the_manager_chat_locks__";
type LockGlobal = typeof globalThis & { [LOCK_KEY]?: Map<string, Promise<void>> };
function getLocks(): Map<string, Promise<void>> {
  const g = globalThis as LockGlobal;
  if (!g[LOCK_KEY]) g[LOCK_KEY] = new Map();
  return g[LOCK_KEY];
}

/**
 * Lines we persist to the conversation transcript. Each is a stored
 * `PromptEvent` plus the prompt that kicked things off and timestamps.
 */
export type TranscriptEntry =
  | { ts: string; kind: "user"; text: string }
  | { ts: string; kind: "event"; event: PromptEvent };

function transcriptFile(projectId: string, conversationId: string): string {
  return join(paths.root(), "conversations", projectId, `${conversationId}.jsonl`);
}

async function getConversationId(projectId: string): Promise<string | null> {
  const file = await store.load();
  return file.data[projectId] ?? null;
}

async function setConversationId(projectId: string, conversationId: string): Promise<void> {
  await store.update((file) => ({ ...file, data: { ...file.data, [projectId]: conversationId } }));
}

async function appendTranscript(
  projectId: string,
  conversationId: string,
  entry: TranscriptEntry,
): Promise<void> {
  const file = transcriptFile(projectId, conversationId);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Resolve the working directory for a given chat target.
 *
 * The Manager has a dedicated cwd (`paths.managerCwd()`); per-project agents
 * run inside the project's registered path. We do not let chat go anywhere
 * else — the cwd is one of two fixed origins.
 */
async function resolveCwd(projectId: ProjectId): Promise<string> {
  if (projectId === MANAGER_PROJECT_ID) {
    const cwd = paths.managerCwd();
    await mkdir(cwd, { recursive: true });
    return cwd;
  }
  const project = await repos.projects.get(projectId);
  return project.path;
}

const PromptSchema = z.object({ prompt: z.string().min(1) });

/**
 * Send a chat message. Yields each PromptEvent as it arrives AND persists the
 * full transcript to disk so the next page load can replay the conversation.
 *
 * Throws ValidationError early if the input shape is wrong; runtime errors
 * surface as `{ type: "error", ... }` events in the stream rather than thrown
 * exceptions — that's the only contract the SSE route relies on.
 */
export async function* sendPrompt(
  projectId: ProjectId,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<PromptEvent> {
  const parsed = PromptSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  }

  // Hold the per-conversation lock for the lifetime of this generator. We
  // capture the previous promise, install our own (resolved at finally), and
  // wait on the previous before doing any work.
  const locks = getLocks();
  const previous = locks.get(projectId) ?? Promise.resolve();
  let release: () => void = () => {};
  const ours = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(projectId, ours);
  await previous;

  try {
    const cwd = await resolveCwd(projectId);
    const ts = new Date().toISOString();
    let conversationId = await getConversationId(projectId);
    const firstMessage = conversationId === null;
    if (!conversationId) {
      conversationId = randomUUID();
      await setConversationId(projectId, conversationId);
    }

    await appendTranscript(projectId, conversationId, {
      ts,
      kind: "user",
      text: parsed.data.prompt,
    });

    try {
      for await (const event of driver.prompt({
        cwd,
        prompt: parsed.data.prompt,
        conversationId,
        firstMessage,
        signal,
      })) {
        yield event;
        await appendTranscript(projectId, conversationId, {
          ts: new Date().toISOString(),
          kind: "event",
          event,
        });
        if (event.type === "session" && event.conversationId !== conversationId) {
          // The CLI re-stamps the session id under unusual conditions (e.g. a
          // user manually deleted the local session). Reconcile by tracking
          // whatever the CLI chose.
          conversationId = event.conversationId;
          await setConversationId(projectId, conversationId);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const evt: PromptEvent = { type: "error", message };
      yield evt;
      await appendTranscript(projectId, conversationId, {
        ts: new Date().toISOString(),
        kind: "event",
        event: evt,
      });
    }
  } finally {
    release();
    // Only clear the map entry if we're still the latest holder; otherwise a
    // newer call has already installed its own promise we shouldn't touch.
    if (locks.get(projectId) === ours) locks.delete(projectId);
  }
}

/**
 * Replay the persisted transcript. Used by the client on mount to render the
 * historical conversation, then it subscribes for live updates.
 */
export async function* readTranscript(projectId: ProjectId): AsyncGenerator<TranscriptEntry> {
  const conversationId = await getConversationId(projectId);
  if (!conversationId) return;
  const file = transcriptFile(projectId, conversationId);
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(file, { encoding: "utf8" });
  } catch {
    return;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      yield JSON.parse(line) as TranscriptEntry;
    } catch {
      /* skip malformed lines */
    }
  }
}

/**
 * Forget the current conversation for a project, so the next prompt starts a
 * fresh one. Does NOT delete the persisted transcript JSONL — that stays on
 * disk as history.
 */
export async function resetConversation(projectId: ProjectId): Promise<void> {
  await store.update((file) => {
    const data = { ...file.data };
    delete data[projectId];
    return { ...file, data };
  });
}

export function newConversationId(): string {
  return randomUUID();
}

// Re-export the symbols a route handler needs.
export type { PromptEvent } from "@the-manager/drivers";
export type { SessionId };
