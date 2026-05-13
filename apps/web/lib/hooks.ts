"use client";

import type {
  AssetRow,
  FileDraftRow,
  ManagerTab,
  ProjectRow,
  ProjectTab,
  SettingsFile,
  UiStateData,
} from "@the-manager/persistence";
import useSWR, { useSWRConfig } from "swr";

// ---------------------------------------------------------------------------
// Fetcher — throws on non-2xx so SWR treats it as an error.
// ---------------------------------------------------------------------------
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export function useProjects() {
  return useSWR<ProjectRow[]>("/api/projects", fetcher);
}

export function useProject(id: string | null) {
  return useSWR<ProjectRow>(id ? `/api/projects/${id}` : null, fetcher);
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------
export interface GitStatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export interface GitStatus {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  not_added: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
  conflicted: string[];
  files: GitStatusFile[];
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface GitData {
  isRepo: boolean;
  branch: string | null;
  status: GitStatus | null;
  log: GitLogEntry[];
}

export function useGit(id: string | null) {
  return useSWR<GitData>(id ? `/api/projects/${id}/git` : null, fetcher, {
    refreshInterval: 10000,
  });
}

export interface GitFileDiff {
  path: string;
  staged: string;
  unstaged: string;
}

export function useGitFileDiff(id: string | null, path: string | null) {
  const key = id && path ? `/api/projects/${id}/git?diff=${encodeURIComponent(path)}` : null;
  return useSWR<GitFileDiff>(key, fetcher);
}

// Mutation helpers. Each one POSTs to /api/projects/{id}/git and the caller is
// responsible for revalidating SWR — they all share the `/api/projects/{id}/git`
// key, so a single mutate after the await refreshes status + log together.
async function postGitAction(projectId: string, body: object): Promise<unknown> {
  const res = await fetch(`/api/projects/${projectId}/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json();
}

export function initGit(projectId: string, remoteUrl?: string): Promise<unknown> {
  return postGitAction(projectId, { action: "init", remoteUrl });
}

export function stageGitFiles(projectId: string, paths: string[]): Promise<unknown> {
  return postGitAction(projectId, { action: "stage", paths });
}

export function unstageGitFiles(projectId: string, paths: string[]): Promise<unknown> {
  return postGitAction(projectId, { action: "unstage", paths });
}

export function commitGit(projectId: string, message: string): Promise<{ hash: string }> {
  return postGitAction(projectId, { action: "commit", message }) as Promise<{ hash: string }>;
}

export async function generateCommitMessage(
  projectId: string,
): Promise<{ message: string; usedFallbackDiff: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/git/commit-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json() as Promise<{ message: string; usedFallbackDiff: boolean }>;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export interface FileEntry {
  name: string;
  type: "dir" | "file";
  path: string;
}

export type FilesData =
  | { type: "dir"; path: string; entries: FileEntry[] }
  | { type: "file"; path: string; content: string; sizeBytes: number; mtime: string };

export function useFiles(id: string | null, path: string) {
  const encoded = encodeURIComponent(path);
  return useSWR<FilesData>(id ? `/api/projects/${id}/files?path=${encoded}` : null, fetcher);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export function useAssets() {
  return useSWR<AssetRow[]>("/api/assets", fetcher);
}

export function useAssetFolders() {
  return useSWR<{ folders: string[] }>("/api/assets/folders", fetcher);
}

// ---------------------------------------------------------------------------
// Session liveness
// ---------------------------------------------------------------------------
export interface SessionStatus {
  alive: boolean;
  lastActivityAt: string | null;
  /** Bumped each time the agent transitions from working back to idle. */
  readyAt: string | null;
}

export function useSessionStatuses() {
  return useSWR<{ statuses: Record<string, SessionStatus> }>("/api/sessions/status", fetcher, {
    refreshInterval: 2000,
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function useSettings() {
  return useSWR<SettingsFile>("/api/settings", fetcher);
}

// ---------------------------------------------------------------------------
// UI state (active view + active tabs). Persisted server-side so opening any
// tab/URL hydrates to the last-known navigation state.
// ---------------------------------------------------------------------------
const UI_STATE_KEY = "/api/ui-state";

export function useUiState() {
  const swr = useSWR<UiStateData>(UI_STATE_KEY, fetcher);
  const { mutate } = useSWRConfig();

  // Optimistically merge `partial` into the cached value and PUT to the server.
  // Server's response wins for the cache once it lands.
  const patchUiState = async (partial: Partial<UiStateData>): Promise<void> => {
    const current = swr.data;
    if (current) {
      const next: UiStateData = {
        ...current,
        ...partial,
        activeTabByProject: {
          ...current.activeTabByProject,
          ...(partial.activeTabByProject ?? {}),
        },
      };
      void mutate(UI_STATE_KEY, next, { revalidate: false });
    }
    const updated = await fetch(UI_STATE_KEY, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    }).then((r) => r.json() as Promise<UiStateData>);
    void mutate(UI_STATE_KEY, updated, { revalidate: false });
  };

  return { ...swr, patchUiState };
}

// Convenience: set the active project tab without re-typing the merge.
export async function setProjectTab(
  patchUiState: (partial: Partial<UiStateData>) => Promise<void>,
  projectId: string,
  tab: ProjectTab,
): Promise<void> {
  await patchUiState({ activeTabByProject: { [projectId]: tab } });
}

export async function setManagerTab(
  patchUiState: (partial: Partial<UiStateData>) => Promise<void>,
  tab: ManagerTab,
): Promise<void> {
  await patchUiState({ activeTabManager: tab });
}

// ---------------------------------------------------------------------------
// File editor drafts. Persisted per (projectId, path) so unsaved edits survive
// reloads and are visible from any tab. Read via a one-shot fetch on file
// selection (intentionally not SWR — caching + revalidateOnMount would race
// the open-file initialization and could surface a stale draft on re-select).
// ---------------------------------------------------------------------------
export async function fetchFileDraft(
  projectId: string,
  path: string,
): Promise<FileDraftRow | null> {
  const res = await fetch(
    `/api/projects/${projectId}/files/draft?path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as FileDraftRow | null;
}

export async function putFileDraft(
  projectId: string,
  path: string,
  content: string,
  baseMtime: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/files/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, baseMtime }),
  });
}

export async function deleteFileDraft(projectId: string, path: string): Promise<void> {
  await fetch(`/api/projects/${projectId}/files/draft`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
