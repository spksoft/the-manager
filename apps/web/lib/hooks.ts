"use client";

import type {
  BranchList,
  CommitDetails,
  GraphNode,
  ProgressEvent,
  RemoteRow,
  StashRow,
  TagRow,
} from "@the-manager/git";
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
// Git GUI hooks — branches, stash, remotes, tags, graph, commit details
// ---------------------------------------------------------------------------
export function useBranches(id: string | null) {
  return useSWR<BranchList>(id ? `/api/projects/${id}/git/branches` : null, fetcher);
}
export function useStashes(id: string | null) {
  return useSWR<StashRow[]>(id ? `/api/projects/${id}/git/stash` : null, fetcher);
}
export function useRemotes(id: string | null) {
  return useSWR<RemoteRow[]>(id ? `/api/projects/${id}/git/remotes` : null, fetcher);
}
export function useTags(id: string | null) {
  return useSWR<TagRow[]>(id ? `/api/projects/${id}/git/tags` : null, fetcher);
}
export function useGraph(id: string | null, max = 500) {
  return useSWR<{ nodes: GraphNode[] }>(
    id ? `/api/projects/${id}/git/graph?max=${max}` : null,
    fetcher,
  );
}
export function useCommit(id: string | null, hash: string | null) {
  return useSWR<CommitDetails>(
    id && hash ? `/api/projects/${id}/git/commits/${hash}` : null,
    fetcher,
  );
}
export function useCommitFileDiff(id: string | null, hash: string | null, path: string | null) {
  return useSWR<{ hash: string; path: string; diff: string }>(
    id && hash && path
      ? `/api/projects/${id}/git/commits/${hash}?path=${encodeURIComponent(path)}`
      : null,
    fetcher,
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let extra: Record<string, unknown> = {};
    try {
      const data = (await res.json()) as Record<string, unknown>;
      extra = data;
      message = (data.message as string) ?? (data.error as string) ?? message;
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & {
      status: number;
      code?: string;
      details?: Record<string, unknown>;
    };
    err.status = res.status;
    err.code = (extra.error as string) ?? undefined;
    err.details = extra;
    throw err;
  }
  return res.json() as Promise<T>;
}

// Branch mutations
export function checkoutBranch(projectId: string, name: string, force = false) {
  return postJson(`/api/projects/${projectId}/git/branches`, {
    action: "checkout",
    name,
    force,
  });
}
export function createBranch(
  projectId: string,
  name: string,
  opts: { startPoint?: string; checkout?: boolean } = {},
) {
  return postJson(`/api/projects/${projectId}/git/branches`, {
    action: "create",
    name,
    startPoint: opts.startPoint,
    checkout: opts.checkout ?? false,
  });
}
export function renameBranch(projectId: string, from: string, to: string) {
  return postJson(`/api/projects/${projectId}/git/branches`, { action: "rename", from, to });
}
export function deleteBranch(
  projectId: string,
  name: string,
  opts: { force?: boolean; remote?: string } = {},
) {
  return postJson(`/api/projects/${projectId}/git/branches`, {
    action: "delete",
    name,
    force: opts.force,
    remote: opts.remote,
  });
}
export function setBranchUpstream(projectId: string, branch: string, upstream: string) {
  return postJson(`/api/projects/${projectId}/git/branches`, {
    action: "set-upstream",
    branch,
    upstream,
  });
}

// Stash mutations
export function stashSave(
  projectId: string,
  opts: { message?: string; includeUntracked?: boolean } = {},
) {
  return postJson(`/api/projects/${projectId}/git/stash`, {
    action: "save",
    message: opts.message,
    includeUntracked: opts.includeUntracked,
  });
}
export function stashApply(projectId: string, index: number, pop = false) {
  return postJson(`/api/projects/${projectId}/git/stash`, { action: "apply", index, pop });
}
export function stashDrop(projectId: string, index: number) {
  return postJson(`/api/projects/${projectId}/git/stash`, { action: "drop", index });
}

// Reset / merge
export function runReset(projectId: string, mode: "soft" | "mixed" | "hard", target: string) {
  return postJson(`/api/projects/${projectId}/git/reset`, { mode, target });
}
export function runMerge(
  projectId: string,
  branch: string,
  opts: { noFastForward?: boolean; squash?: boolean } = {},
) {
  return postJson(`/api/projects/${projectId}/git/merge`, { branch, ...opts });
}

// Hunk staging
export function stageHunk(projectId: string, patch: string) {
  return postJson(`/api/projects/${projectId}/git/hunk`, { action: "stage", patch });
}
export function unstageHunk(projectId: string, patch: string) {
  return postJson(`/api/projects/${projectId}/git/hunk`, { action: "unstage", patch });
}

// Remote ops — POST + SSE response. The standard EventSource can't POST, so
// we use fetch + ReadableStream and parse SSE lines manually.
export interface RemoteOpBody {
  action: "fetch" | "pull" | "push";
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  force?: boolean;
  tags?: boolean;
  prune?: boolean;
  rebase?: boolean;
}

export interface RemoteOpHandlers {
  onProgress?: (e: ProgressEvent) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export interface RemoteOpHandle {
  cancel: () => void;
  /** Resolves when the op terminates (done OR error). Never rejects. */
  finished: Promise<void>;
}

export function streamRemoteOp(
  projectId: string,
  body: RemoteOpBody,
  handlers: RemoteOpHandlers,
): RemoteOpHandle {
  const ctrl = new AbortController();
  let resolveFinished!: () => void;
  const finished = new Promise<void>((res) => {
    resolveFinished = res;
  });

  const run = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/git/remote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        let message = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { message?: string; error?: string };
          message = data.message ?? data.error ?? message;
        } catch {
          // ignore
        }
        handlers.onError?.(message);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // SSE messages are separated by blank lines; each contains `event: X` + `data: Y`.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n\n");
        while (nl !== -1) {
          const msg = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          processMessage(msg, handlers);
          nl = buf.indexOf("\n\n");
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // user cancelled — not an error path
      } else {
        handlers.onError?.((err as Error).message ?? String(err));
      }
    } finally {
      resolveFinished();
    }
  };
  void run();

  return {
    cancel: () => ctrl.abort(),
    finished,
  };
}

function processMessage(msg: string, handlers: RemoteOpHandlers) {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of msg.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
  }
  const dataStr = dataLines.join("\n");
  let data: unknown = null;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // not JSON — leave as null
  }
  if (event === "progress" && data && typeof data === "object") {
    handlers.onProgress?.(data as ProgressEvent);
  } else if (event === "done") {
    handlers.onDone?.();
  } else if (event === "error") {
    const m = (data as { message?: string } | null)?.message ?? "remote op failed";
    handlers.onError?.(m);
  }
}

// Invalidation helper — call from components after mutations.
export interface InvalidateKeys {
  git?: boolean;
  branches?: boolean;
  stash?: boolean;
  graph?: boolean;
  diff?: string | null;
  commit?: string | null;
}
export function makeGitInvalidator(projectId: string, mutate: (key: string) => Promise<unknown>) {
  return (keys: InvalidateKeys = {}) => {
    const promises: Promise<unknown>[] = [];
    if (keys.git !== false) promises.push(mutate(`/api/projects/${projectId}/git`));
    if (keys.branches) promises.push(mutate(`/api/projects/${projectId}/git/branches`));
    if (keys.stash) promises.push(mutate(`/api/projects/${projectId}/git/stash`));
    if (keys.graph) promises.push(mutate(`/api/projects/${projectId}/git/graph?max=500`));
    if (keys.diff) {
      promises.push(mutate(`/api/projects/${projectId}/git?diff=${encodeURIComponent(keys.diff)}`));
    }
    if (keys.commit) {
      promises.push(mutate(`/api/projects/${projectId}/git/commits/${keys.commit}`));
    }
    return Promise.all(promises);
  };
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
        commitMessageDraftByProject: {
          ...current.commitMessageDraftByProject,
          ...(partial.commitMessageDraftByProject ?? {}),
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

export async function setCommitMessageDraft(
  patchUiState: (partial: Partial<UiStateData>) => Promise<void>,
  projectId: string,
  message: string,
): Promise<void> {
  await patchUiState({ commitMessageDraftByProject: { [projectId]: message } });
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
