"use client";

import { Button } from "@the-manager/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";

interface DirectoryListResponse {
  path: string;
  parent: string | null;
  home: string;
  entries: { name: string }[];
}

interface DirectoryPickerDialogProps {
  open: boolean;
  initialPath?: string;
  onCancel: () => void;
  onPick: (absolutePath: string) => void;
}

/**
 * Web-surface fallback for picking a directory. Walks the local filesystem
 * via /api/fs/listdir — the Next server runs on the same machine as the
 * user. The Electron surface uses the native OS dialog instead and never
 * mounts this component.
 */
export function DirectoryPickerDialog({
  open,
  initialPath,
  onCancel,
  onPick,
}: DirectoryPickerDialogProps) {
  const [path, setPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<{ name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [submittingNew, setSubmittingNew] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : "";
      const res = await fetch(`/api/fs/listdir${qs}`, { cache: "no-store" });
      const body = (await res.json()) as DirectoryListResponse | { message?: string };
      if (!res.ok) {
        throw new Error(("message" in body && body.message) || `HTTP ${res.status}`);
      }
      const ok = body as DirectoryListResponse;
      setPath(ok.path);
      setDraft(ok.path);
      setParent(ok.parent);
      setEntries(ok.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload from the seed path whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setNewFolderName("");
    void navigate(initialPath && initialPath.trim().length > 0 ? initialPath : undefined);
  }, [open, initialPath, navigate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const submitDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (value.length > 0) void navigate(value);
  };

  const submitNewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!path || name.length === 0) return;
    setSubmittingNew(true);
    setError(null);
    try {
      const res = await fetch("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: path, name }),
      });
      const body = (await res.json()) as { path?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setCreating(false);
      setNewFolderName("");
      await navigate(body.path ?? path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingNew(false);
    }
  };

  return (
    <>
      <div
        aria-hidden="true"
        className="animate-fade-in fixed inset-0 z-[60] bg-black/60"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dir-picker-title"
        className="animate-scale-in fixed inset-x-2 inset-y-4 z-[70] flex flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl md:inset-auto md:left-1/2 md:top-1/2 md:h-[32rem] md:w-full md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="dir-picker-title" className="text-base font-semibold text-zinc-100">
            Pick a folder
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <form onSubmit={submitDraft} className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Current path"
              placeholder="/absolute/path"
              className="flex-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <Button type="submit" variant="ghost" disabled={loading}>
              Go
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loading || !path || creating}
              onClick={() => {
                setCreating(true);
                setNewFolderName("");
                setError(null);
                // Defer focus until after the input is mounted.
                requestAnimationFrame(() => newFolderInputRef.current?.focus());
              }}
            >
              New folder
            </Button>
          </form>

          {creating && (
            <form onSubmit={submitNewFolder} className="flex gap-2">
              <input
                ref={newFolderInputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                spellCheck={false}
                aria-label="New folder name"
                placeholder="folder-name"
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <Button
                type="submit"
                variant="ghost"
                disabled={submittingNew || newFolderName.trim().length === 0}
              >
                {submittingNew ? "Creating…" : "Create"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={submittingNew}
                onClick={() => {
                  setCreating(false);
                  setNewFolderName("");
                }}
              >
                Cancel
              </Button>
            </form>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-900 px-2 py-2">
          {parent && (
            <button
              type="button"
              onClick={() => void navigate(parent)}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-900"
            >
              <span className="text-zinc-500">↩</span>
              <span className="font-mono text-xs text-zinc-400">..</span>
            </button>
          )}
          {entries.length === 0 && !loading && (
            <p className="px-3 py-4 text-xs text-zinc-500">No subfolders.</p>
          )}
          {entries.map((entry) => {
            const next = path ? joinPath(path, entry.name) : entry.name;
            return (
              <button
                key={entry.name}
                type="button"
                onClick={() => void navigate(next)}
                className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-900"
              >
                <span className="text-zinc-500">📁</span>
                <span className="truncate">{entry.name}</span>
              </button>
            );
          })}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-zinc-800 px-5 py-4">
          <span className="truncate font-mono text-[11px] text-zinc-500">{path ?? ""}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={loading || !path}
              onClick={() => {
                if (path) onPick(path);
              }}
            >
              Select this folder
            </Button>
          </div>
        </footer>
      </div>
    </>
  );
}

function joinPath(base: string, name: string): string {
  if (base.endsWith("/")) return `${base}${name}`;
  return `${base}/${name}`;
}
