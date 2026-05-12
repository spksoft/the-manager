import "server-only";
import type { ProjectId } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../lib/api";
import { readTranscript, resetConversation } from "../../../../../lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Replay the persisted transcript for this project's (or the Manager's)
 * Claude conversation. The shape mirrors what the UI receives over SSE:
 *   - `{ ts, kind: "user", text }` — a user message
 *   - `{ ts, kind: "event", event: PromptEvent }` — anything we streamed back
 *
 * Returns an empty `entries` array if no conversation has been started yet.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const entries = [];
    for await (const entry of readTranscript(id as ProjectId)) {
      entries.push(entry);
    }
    return jsonOk({ entries });
  } catch (err) {
    return handleErr(err);
  }
}

/**
 * "Start a new conversation" — forgets the current conversation id for this
 * project. The next POST /messages will mint a fresh UUID. The persisted
 * transcript stays on disk as history.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await resetConversation(id as ProjectId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleErr(err);
  }
}
