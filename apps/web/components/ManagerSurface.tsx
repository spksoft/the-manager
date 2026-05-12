"use client";

import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import { ChatView } from "./ChatView";

/**
 * The Manager is just a chat against `claude -p` running in the dedicated
 * `~/.the-manager/manager/cwd` directory. Conversation continuity is handled
 * by ChatView reusing the same project id (`MANAGER_PROJECT_ID`) across page
 * loads — the server persists one conversation UUID per id.
 */
export function ManagerSurface() {
  return (
    <ChatView
      projectId={MANAGER_PROJECT_ID}
      emptyHint="Tell the Manager what to do — it can orchestrate agents across your projects."
    />
  );
}
