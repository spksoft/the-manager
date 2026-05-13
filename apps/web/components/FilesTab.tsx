"use client";

import type { SupportedLanguage } from "@the-manager/editor";
import { MiniEditor } from "@the-manager/editor";
import type { FileDraftRow } from "@the-manager/persistence";
import { Button, Sheet } from "@the-manager/ui";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import type { FileEntry } from "../lib/hooks";
import { deleteFileDraft, fetchFileDraft, putFileDraft, useFiles } from "../lib/hooks";
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

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------
function detectLanguage(filename: string): SupportedLanguage {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "mdx") return "markdown";
  return "plaintext";
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
    return (
      <li className="group">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            <span aria-hidden>{expanded ? "▾" : "▸"}</span>
            <span className="font-medium">{entry.name}/</span>
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
          <span aria-hidden className="text-zinc-600">
            —
          </span>
          {entry.name}
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

  const mutateDirs = (dirs: string[]) => {
    const unique = Array.from(new Set(dirs));
    return Promise.all(unique.map((d) => swrMutate(filesKey(projectId, d))));
  };

  const newFile = async () => {
    const path = window.prompt("New file (project-relative):", "");
    if (!path) return;
    const trimmed = path.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: trimmed, content: "" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setTreeErr(body.message ?? `HTTP ${res.status}`);
      return;
    }
    await mutateDirs([dirOf(trimmed)]);
    setSelectedPath(trimmed);
    setSavedMtime(undefined);
  };

  const newFolder = async () => {
    const path = window.prompt("New folder (project-relative):", "");
    if (!path) return;
    const trimmed = path.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: trimmed, kind: "dir" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setTreeErr(body.message ?? `HTTP ${res.status}`);
      return;
    }
    await mutateDirs([dirOf(trimmed)]);
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

  const handleSelect = (path: string) => {
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

  const handleSelectAndClose = (path: string) => {
    handleSelect(path);
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
            onClick={newFile}
            aria-label="New file"
            title="New file"
            className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 md:p-0.5"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={newFolder}
            aria-label="New folder"
            title="New folder"
            className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 md:p-0.5"
          >
            📁
          </button>
        </span>
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
        <FileTree
          projectId={projectId}
          dirPath=""
          onSelect={handleSelectAndClose}
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
    </div>
  );
}
