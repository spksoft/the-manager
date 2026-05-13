"use client";

import type { AssetRow, ProjectRow, SettingsFile } from "@the-manager/persistence";
import useSWR from "swr";

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
