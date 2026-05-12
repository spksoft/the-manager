"use client";

import type { SupportedLanguage } from "@the-manager/editor";
import { MiniEditor } from "@the-manager/editor";
import { Button } from "@the-manager/ui";
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../lib/hooks";
import { useFiles } from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";

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
}

function FileTree({ projectId, dirPath, onSelect, selectedPath }: FileTreeProps) {
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
}

function FileTreeEntry({ projectId, entry, onSelect, selectedPath }: FileTreeEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedPath === entry.path;

  if (entry.type === "dir") {
    return (
      <li>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
        >
          <span aria-hidden>{expanded ? "▾" : "▸"}</span>
          <span className="font-medium">{entry.name}/</span>
        </button>
        {expanded && (
          <FileTree
            projectId={projectId}
            dirPath={entry.path}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry.path)}
        className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs transition-colors ${
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
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stale-dialog-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="p-5">
          <h2 id="stale-dialog-title" className="mb-2 text-sm font-semibold text-zinc-100">
            File changed on disk
          </h2>
          <p className="mb-5 text-sm text-zinc-400">
            The file was modified since you opened it. Reload to discard your changes, or save
            anyway to overwrite.
          </p>
          <div className="flex justify-end gap-2">
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [savedMtime, setSavedMtime] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showStaleDialog, setShowStaleDialog] = useState(false);
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
    const dirty = editorValueRef.current !== savedContentRef.current;
    if (dirty && selectedPath && path !== selectedPath) {
      const ok = window.confirm("You have unsaved changes. Discard them and open the other file?");
      if (!ok) return;
    }
    setSelectedPath(path);
    setSaveErr(null);
    setSavedMtime(undefined);
  };

  // Sync editor when file data changes
  if (
    fileData &&
    fileData.type === "file" &&
    savedMtime === undefined &&
    fileData.content !== editorValue
  ) {
    setEditorValue(fileData.content);
    setSavedContent(fileData.content);
    setSavedMtime(fileData.mtime);
  }

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
    setSavedMtime(undefined);
    await mutateFile();
    if (fileData?.type === "file") {
      setEditorValue(fileData.content);
      setSavedContent(fileData.content);
      setSavedMtime(fileData.mtime);
    }
  };
  const dirty = editorValue !== savedContent;

  return (
    <div className="flex h-full gap-3">
      {/* File tree pane */}
      <div className="flex w-52 flex-shrink-0 flex-col overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 py-2">
        <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Files
        </span>
        <FileTree
          projectId={projectId}
          dirPath=""
          onSelect={handleSelect}
          selectedPath={selectedPath}
        />
      </div>

      {/* Editor pane */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {saveErr && <ErrorBanner message={saveErr} onDismiss={() => setSaveErr(null)} />}
        {selectedPath ? (
          <>
            <div className="flex flex-shrink-0 items-center justify-between gap-2">
              <span className="font-mono text-xs text-zinc-400">
                {selectedPath}
                {dirty && (
                  <span role="img" aria-label="Unsaved changes" className="ml-1 text-amber-400">
                    ●
                  </span>
                )}
              </span>
              <Button
                onClick={() => doSave(false)}
                disabled={saving || !fileData || !dirty}
                aria-label="Save file (Cmd+S)"
                title="⌘S"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800">
              <MiniEditor
                value={editorValue}
                language={detectLanguage(selectedPath.split("/").pop() ?? "")}
                onChange={setEditorValue}
                height="100%"
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-600">
            Select a file to edit
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
