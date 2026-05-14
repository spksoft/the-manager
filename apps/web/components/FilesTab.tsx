"use client";

import { detectLanguage, MiniEditor } from "@the-manager/editor";
import type { FileDraftRow } from "@the-manager/persistence";
import { Button, Sheet } from "@the-manager/ui";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus, Search, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { fileIcon, folderIcon } from "../lib/file-icons";
import type { FileEntry, FileSearchMode } from "../lib/hooks";
import {
  deleteFileDraft,
  fetchFileDraft,
  putFileDraft,
  useFileSearch,
  useFiles,
} from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";

// ---------------------------------------------------------------------------
// Tree-mutation helpers
// ---------------------------------------------------------------------------
function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function filesKey(projectId: string, dirPath: string): string {
  return `/api/projects/${projectId}/files?path=${encodeURIComponent(dirPath)}`;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------
interface FileTreeProps {
  projectId: string;
  dirPath: string;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onMutated: (affectedDirs: string[]) => void;
  onSelectionGone: (path: string) => void;
}

function FileTree({
  projectId,
  dirPath,
  onSelect,
  selectedPath,
  onMutated,
  onSelectionGone,
}: FileTreeProps) {
  const { data, error, isLoading } = useFiles(projectId, dirPath);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 pl-3">
        {[...Array(4)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
          <div key={i} className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error || !data || data.type !== "dir") {
    return <span className="pl-3 text-xs text-red-400">Error loading</span>;
  }

  if (data.entries.length === 0) {
    return <span className="pl-3 text-xs text-zinc-600">Empty folder</span>;
  }

  return (
    <ul className="flex flex-col gap-0.5 pl-3">
      {data.entries.map((entry) => (
        <FileTreeEntry
          key={entry.path}
          projectId={projectId}
          entry={entry}
          onSelect={onSelect}
          selectedPath={selectedPath}
          onMutated={onMutated}
          onSelectionGone={onSelectionGone}
        />
      ))}
    </ul>
  );
}

interface FileTreeEntryProps {
  projectId: string;
  entry: FileEntry;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onMutated: (affectedDirs: string[]) => void;
  onSelectionGone: (path: string) => void;
}

function FileTreeEntry({
  projectId,
  entry,
  onSelect,
  selectedPath,
  onMutated,
  onSelectionGone,
}: FileTreeEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedPath === entry.path;

  const rename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = window.prompt(
      `Rename ${entry.type === "dir" ? "directory" : "file"} (project-relative):`,
      entry.path,
    );
    if (!next || next.trim() === "" || next === entry.path) return;
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: entry.path, to: next.trim() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      window.alert(body.message ?? `Rename failed: HTTP ${res.status}`);
      return;
    }
    if (selectedPath === entry.path) onSelectionGone(entry.path);
    onMutated([dirOf(entry.path), dirOf(next.trim())]);
  };

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const recursive = entry.type === "dir";
    const msg = recursive
      ? `Delete folder "${entry.path}" and everything inside? This cannot be undone.`
      : `Delete file "${entry.path}"?`;
    if (!window.confirm(msg)) return;
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entry.path, recursive }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      window.alert(body.message ?? `Delete failed: HTTP ${res.status}`);
      return;
    }
    if (selectedPath === entry.path) onSelectionGone(entry.path);
    onMutated([dirOf(entry.path)]);
  };

  if (entry.type === "dir") {
    const folder = folderIcon(expanded);
    return (
      <li className="group">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            {expanded ? (
              <ChevronDown size={12} className="shrink-0 text-zinc-500" aria-hidden />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-zinc-500" aria-hidden />
            )}
            <folder.Icon size={14} className={`shrink-0 ${folder.className}`} aria-hidden />
            <span className="truncate font-medium">{entry.name}</span>
          </button>
          <span className="flex items-center transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button
              type="button"
              onClick={rename}
              aria-label={`Rename ${entry.path}`}
              title="Rename"
              className="rounded p-0.5 text-zinc-600 hover:text-zinc-200"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={remove}
              aria-label={`Delete ${entry.path}`}
              title="Delete (recursive)"
              className="rounded p-0.5 text-zinc-600 hover:text-red-400"
            >
              ✕
            </button>
          </span>
        </div>
        {expanded && (
          <FileTree
            projectId={projectId}
            dirPath={entry.path}
            onSelect={onSelect}
            selectedPath={selectedPath}
            onMutated={onMutated}
            onSelectionGone={onSelectionGone}
          />
        )}
      </li>
    );
  }

  const icon = fileIcon(entry.name);
  return (
    <li className="group">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onSelect(entry.path)}
          className={`flex flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs transition-colors ${
            isSelected
              ? "bg-zinc-700/60 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
          }`}
        >
          <span className="w-3 shrink-0" aria-hidden />
          <icon.Icon size={14} className={`shrink-0 ${icon.className}`} aria-hidden />
          <span className="truncate">{entry.name}</span>
        </button>
        <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={rename}
            aria-label={`Rename ${entry.path}`}
            title="Rename"
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-200"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label={`Delete ${entry.path}`}
            title="Delete"
            className="rounded p-0.5 text-zinc-600 hover:text-red-400"
          >
            ✕
          </button>
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Stale mtime dialog
// ---------------------------------------------------------------------------
interface StaleDialogProps {
  onReload: () => void;
  onSaveAnyway: () => void;
  onClose: () => void;
}

function StaleDialog({ onReload, onSaveAnyway, onClose }: StaleDialogProps) {
  return (
    <>
      <div
        aria-hidden="true"
        className="animate-fade-in fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stale-dialog-title"
        className="animate-scale-in fixed left-1/2 top-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="p-5">
          <h2 id="stale-dialog-title" className="mb-2 text-sm font-semibold text-zinc-100">
            File changed on disk
          </h2>
          <p className="mb-5 text-sm text-zinc-400">
            The file was modified since you opened it. Reload to discard your changes, or save
            anyway to overwrite.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="ghost" onClick={onReload}>
              Reload
            </Button>
            <Button type="button" onClick={onSaveAnyway}>
              Save anyway
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// NameInputDialog — inline replacement for window.prompt, which Electron
// disables (returns null), making New file / New folder silently no-op in the
// desktop app.
// ---------------------------------------------------------------------------
interface NameInputDialogProps {
  title: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}

function NameInputDialog({
  title,
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}: NameInputDialogProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        aria-hidden="true"
        className="animate-fade-in fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-input-dialog-title"
        className="animate-scale-in fixed left-1/2 top-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <form onSubmit={submit} className="flex flex-col gap-3 p-5">
          <h2 id="name-input-dialog-title" className="text-sm font-semibold text-zinc-100">
            {title}
          </h2>
          <label htmlFor="name-input-dialog-value" className="text-xs text-zinc-400">
            {label}
          </label>
          <input
            id="name-input-dialog-value"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !value.trim()}>
              {submitting ? "Working…" : submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SearchResults
// ---------------------------------------------------------------------------
interface SearchResultsProps {
  query: string;
  mode: FileSearchMode;
  data: import("../lib/hooks").FileSearchResponse | undefined;
  isLoading: boolean;
  error: Error | undefined;
  onSelect: (path: string, line?: number) => void;
}

function SearchResults({ query, mode, data, isLoading, error, onSelect }: SearchResultsProps) {
  if (error) {
    return <div className="pl-3 text-xs text-red-400">{error.message}</div>;
  }
  if (!data && isLoading) {
    return (
      <div className="flex flex-col gap-1 pl-3">
        {[...Array(4)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
          <div key={i} className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
        ))}
      </div>
    );
  }
  if (!data || data.results.length === 0) {
    return <div className="pl-3 text-xs text-zinc-600">No matches</div>;
  }
  return (
    <div className="flex flex-col gap-0.5 pb-2">
      {data.results.map((r) => {
        const name = basename(r.path);
        const icon = fileIcon(name);
        const dir = dirOf(r.path);
        if (mode === "name") {
          return (
            <button
              key={r.path}
              type="button"
              onClick={() => onSelect(r.path)}
              title={r.path}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <icon.Icon size={14} className={`shrink-0 ${icon.className}`} aria-hidden />
              <span className="truncate">{name}</span>
              {dir && <span className="truncate text-[10px] text-zinc-600">{dir}</span>}
            </button>
          );
        }
        return (
          <div key={r.path} className="flex flex-col">
            <button
              type="button"
              onClick={() => onSelect(r.path, r.matches?.[0]?.line)}
              title={r.path}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-zinc-200 hover:bg-zinc-800/60"
            >
              <icon.Icon size={14} className={`shrink-0 ${icon.className}`} aria-hidden />
              <span className="truncate font-medium">{name}</span>
              {dir && <span className="truncate text-[10px] text-zinc-600">{dir}</span>}
            </button>
            {r.matches?.map((m) => (
              <button
                key={`${r.path}:${m.line}:${m.col}`}
                type="button"
                onClick={() => onSelect(r.path, m.line)}
                className="ml-6 flex items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
              >
                <span className="w-7 shrink-0 text-right text-zinc-600 tabular-nums">{m.line}</span>
                <span className="truncate font-mono">{m.preview}</span>
              </button>
            ))}
          </div>
        );
      })}
      {data.truncated && (
        <div className="px-1.5 py-1 text-[10px] text-zinc-600">
          Results truncated. Refine "{query}" for more matches.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main FilesTab
// ---------------------------------------------------------------------------
interface FilesTabProps {
  projectId: string;
}

export function FilesTab({ projectId }: FilesTabProps) {
  const { mutate: swrMutate } = useSWRConfig();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [savedMtime, setSavedMtime] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showStaleDialog, setShowStaleDialog] = useState(false);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  // `undefined` = draft fetch in flight, `null` = no draft on server, row = draft present.
  // Used together with `fileData` to decide whether to restore the draft when a
  // file is first opened.
  const [draftLoaded, setDraftLoaded] = useState<FileDraftRow | null | undefined>(undefined);
  const [treeOpen, setTreeOpen] = useState(false);
  const [pendingNew, setPendingNew] = useState<"file" | "folder" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<FileSearchMode>("name");
  const [initialLine, setInitialLine] = useState<number | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const search = useFileSearch(projectId, searchQuery, searchMode);
  const isSearching = searchQuery.trim().length >= 2;

  const mutateDirs = (dirs: string[]) => {
    const unique = Array.from(new Set(dirs));
    return Promise.all(unique.map((d) => swrMutate(filesKey(projectId, d))));
  };

  const createFile = async (path: string) => {
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: "" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setTreeErr(body.message ?? `HTTP ${res.status}`);
      return;
    }
    await mutateDirs([dirOf(path)]);
    setSelectedPath(path);
    setSavedMtime(undefined);
    setPendingNew(null);
  };

  const createFolder = async (path: string) => {
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, kind: "dir" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setTreeErr(body.message ?? `HTTP ${res.status}`);
      return;
    }
    await mutateDirs([dirOf(path)]);
    setPendingNew(null);
  };
  // Tracks the editor's persisted-on-disk content so we can detect unsaved
  // edits and prompt before discarding them when the user clicks a new file.
  const [savedContent, setSavedContent] = useState<string>("");
  const editorValueRef = useRef(editorValue);
  const savedContentRef = useRef(savedContent);
  useEffect(() => {
    editorValueRef.current = editorValue;
  }, [editorValue]);
  useEffect(() => {
    savedContentRef.current = savedContent;
  }, [savedContent]);

  const { data: fileData, mutate: mutateFile } = useFiles(
    selectedPath ? projectId : null,
    selectedPath ?? "",
  );

  const handleSelect = (path: string, line?: number) => {
    if (selectedPath && path !== selectedPath) {
      // A debounced draft PUT may still be pending against the OLD path. The
      // server only stores the persisted-to-disk state, so dropping the
      // pending write isn't a data-loss event — but to keep behavior
      // intuitive, we always at least flush the current editorValue to the
      // OLD path's draft before switching, so it can be restored when the
      // user navigates back.
      if (savedMtime && editorValueRef.current !== savedContentRef.current) {
        void putFileDraft(projectId, selectedPath, editorValueRef.current, savedMtime);
      }
    }
    setSelectedPath(path);
    setSaveErr(null);
    setSavedMtime(undefined);
    setDraftLoaded(undefined);
    setInitialLine(line);
  };

  // Load draft on selection change. One-shot fetch (not SWR) so re-selecting a
  // recently-viewed file always reads fresh state.
  useEffect(() => {
    if (!selectedPath) {
      setDraftLoaded(undefined);
      setEditorValue("");
      setSavedContent("");
      setSavedMtime(undefined);
      return;
    }
    let cancelled = false;
    setDraftLoaded(undefined);
    void fetchFileDraft(projectId, selectedPath).then((draft) => {
      if (!cancelled) setDraftLoaded(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, projectId]);

  // Initialization gate: fires once per (selection) when both file data and the
  // one-shot draft fetch have landed. `savedMtime === undefined` is the
  // "not yet initialized" sentinel; setting it closes the gate.
  if (
    fileData &&
    fileData.type === "file" &&
    savedMtime === undefined &&
    draftLoaded !== undefined &&
    selectedPath
  ) {
    const useDraft = !!(draftLoaded && draftLoaded.baseMtime === fileData.mtime);
    setEditorValue(useDraft && draftLoaded ? draftLoaded.content : fileData.content);
    setSavedContent(fileData.content);
    setSavedMtime(fileData.mtime);
    if (draftLoaded && !useDraft) {
      // Draft is for an older on-disk version — discard so it can't surface later.
      void deleteFileDraft(projectId, selectedPath);
    }
  }

  // Debounced draft persistence on every edit.
  useEffect(() => {
    if (!selectedPath || !savedMtime) return;
    if (editorValue === savedContent) return;
    const handle = setTimeout(() => {
      void putFileDraft(projectId, selectedPath, editorValue, savedMtime);
    }, 400);
    return () => clearTimeout(handle);
  }, [editorValue, savedContent, savedMtime, projectId, selectedPath]);

  const doSave = async (force = false) => {
    if (!selectedPath) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedPath,
          content: editorValue,
          mtime: force ? undefined : savedMtime,
        }),
      });
      if (res.status === 409) {
        setShowStaleDialog(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { mtime: string };
      setSavedMtime(result.mtime);
      setSavedContent(editorValue);
      // File on disk now matches editor — the draft is redundant.
      if (selectedPath) void deleteFileDraft(projectId, selectedPath);
      await mutateFile();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S to save the current file. `doSave` captures the latest state
  // via the ref-backed closures above, so we don't have to re-bind every render.
  const doSaveRef = useRef<(force?: boolean) => void>(() => {});
  useEffect(() => {
    doSaveRef.current = doSave;
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        if (!selectedPath) return;
        e.preventDefault();
        doSaveRef.current(false);
      }
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        // Don't steal Cmd+Shift+P (palette) — only the plain combo focuses search.
        if (e.shiftKey) return;
        const input = searchInputRef.current;
        if (!input) return;
        e.preventDefault();
        input.focus();
        input.select();
        setTreeOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedPath]);

  // Warn the user if they try to close the tab with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (editorValueRef.current !== savedContentRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const handleReload = async () => {
    setShowStaleDialog(false);
    // User explicitly chose "discard my edits, use disk content".
    if (selectedPath) void deleteFileDraft(projectId, selectedPath);
    setSavedMtime(undefined);
    await mutateFile();
    if (fileData?.type === "file") {
      setEditorValue(fileData.content);
      setSavedContent(fileData.content);
      setSavedMtime(fileData.mtime);
    }
  };
  const dirty = editorValue !== savedContent;

  const handleSelectAndClose = (path: string, line?: number) => {
    handleSelect(path, line);
    setTreeOpen(false);
  };

  const treePane = (
    <>
      <div className="flex items-center justify-between px-3 pb-1 pt-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Files
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setPendingNew("file")}
            aria-label="New file"
            title="New file"
            className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 md:p-1"
          >
            <FilePlus size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPendingNew("folder")}
            aria-label="New folder"
            title="New folder"
            className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 md:p-1"
          >
            <FolderPlus size={14} aria-hidden />
          </button>
        </span>
      </div>
      <div className="px-2 pb-1">
        <div className="relative flex items-center">
          <Search
            size={12}
            aria-hidden
            className="pointer-events-none absolute left-2 text-zinc-500"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchMode === "name" ? "Find files…" : "Find in files…"}
            aria-label="Search files"
            className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950/60 pl-7 pr-14 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <div className="absolute right-1 flex items-center gap-0.5">
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
                title="Clear"
                className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
              >
                <X size={12} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSearchMode((m) => (m === "name" ? "content" : "name"))}
              aria-label={`Switch to ${searchMode === "name" ? "content" : "name"} search`}
              title={
                searchMode === "name"
                  ? "Name match (click for content)"
                  : "Content match (click for name)"
              }
              className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                searchMode === "content"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {searchMode === "name" ? "Aa" : "·*"}
            </button>
          </div>
        </div>
      </div>
      {treeErr && (
        <div className="mx-2 mb-1 rounded border border-red-900/60 bg-red-950/30 px-2 py-1 text-[11px] text-red-300">
          {treeErr}
          <button
            type="button"
            onClick={() => setTreeErr(null)}
            aria-label="Dismiss error"
            className="ml-1 text-red-400/70 hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isSearching ? (
          <SearchResults
            query={searchQuery}
            mode={searchMode}
            data={search.data}
            isLoading={search.isLoading}
            error={search.error}
            onSelect={handleSelectAndClose}
          />
        ) : (
          <FileTree
            projectId={projectId}
            dirPath=""
            onSelect={(p) => handleSelectAndClose(p)}
            selectedPath={selectedPath}
            onMutated={(dirs) => {
              void mutateDirs(dirs);
            }}
            onSelectionGone={(gonePath) => {
              // The file/dir was renamed or deleted on disk — any draft for it is
              // now moot and would only confuse a future open of an unrelated
              // file at the same path.
              void deleteFileDraft(projectId, gonePath);
              setSelectedPath(null);
              setSavedMtime(undefined);
              setEditorValue("");
              setSavedContent("");
            }}
          />
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full gap-3">
      {/* File tree pane — visible on md+, collapsed into Sheet on mobile */}
      <div className="hidden w-52 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30 py-1 md:flex">
        {treePane}
      </div>

      <Sheet open={treeOpen} onOpenChange={setTreeOpen} side="left" ariaLabel="File tree">
        <div className="flex h-full flex-col">{treePane}</div>
      </Sheet>

      {/* Editor pane */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {saveErr && <ErrorBanner message={saveErr} onDismiss={() => setSaveErr(null)} />}
        <div className="flex flex-shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setTreeOpen(true)}
              aria-label="Open file tree"
              className="flex h-8 items-center gap-1 rounded-md border border-zinc-800 px-2 text-xs text-zinc-300 hover:bg-zinc-800/60 md:hidden"
            >
              <span aria-hidden>☰</span> Files
            </button>
            {selectedPath ? (
              <span className="min-w-0 truncate font-mono text-xs text-zinc-400">
                {selectedPath}
                {dirty && (
                  <span role="img" aria-label="Unsaved changes" className="ml-1 text-amber-400">
                    ●
                  </span>
                )}
              </span>
            ) : (
              <span className="hidden text-xs text-zinc-600 md:inline">No file open</span>
            )}
          </div>
          {selectedPath && (
            <Button
              onClick={() => doSave(false)}
              disabled={saving || !fileData || !dirty}
              aria-label="Save file (Cmd+S)"
              title="⌘S"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
        {selectedPath ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800">
            {/* absolute inset-0 gives CodeMirror a strictly-sized container; without it, height="100%" can collapse to 0 inside the flex chain and content overflows silently. */}
            <div className="absolute inset-0">
              <MiniEditor
                value={editorValue}
                language={detectLanguage(selectedPath.split("/").pop() ?? "")}
                onChange={setEditorValue}
                height="100%"
                initialLine={initialLine}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-800 px-4 text-center text-sm text-zinc-600">
            <span className="md:hidden">Tap "Files" to pick something to edit</span>
            <span className="hidden md:inline">Select a file to edit</span>
          </div>
        )}
      </div>

      {showStaleDialog && (
        <StaleDialog
          onReload={handleReload}
          onSaveAnyway={async () => {
            setShowStaleDialog(false);
            await doSave(true);
          }}
          onClose={() => setShowStaleDialog(false)}
        />
      )}

      {pendingNew === "file" && (
        <NameInputDialog
          title="New file"
          label="Path (project-relative)"
          placeholder="src/example.ts"
          submitLabel="Create file"
          onSubmit={createFile}
          onClose={() => setPendingNew(null)}
        />
      )}
      {pendingNew === "folder" && (
        <NameInputDialog
          title="New folder"
          label="Path (project-relative)"
          placeholder="src/components"
          submitLabel="Create folder"
          onSubmit={createFolder}
          onClose={() => setPendingNew(null)}
        />
      )}
    </div>
  );
}
