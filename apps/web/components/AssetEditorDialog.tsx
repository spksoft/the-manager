"use client";

import { MiniEditor, type SupportedLanguage } from "@the-manager/editor";
import type { AssetRow, ProjectRow } from "@the-manager/persistence";
import { Button } from "@the-manager/ui";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";

const MAX_EDIT_BYTES = 1024 * 1024; // mirrors files-route cap; refuse to inline-edit larger blobs

interface AssetEditorDialogProps {
  open: boolean;
  /** null = create mode; an AssetRow = edit mode. */
  asset: AssetRow | null;
  /** Pre-fills the folder field when creating. Ignored when editing. */
  initialFolder: string | null;
  /** Pre-fills the scope select when creating. Ignored when editing. */
  initialScope: string;
  projects: ProjectRow[];
  folders: string[];
  onClose: () => void;
  /** Fires after a successful save; payload is the (newly created or updated) asset. */
  onSaved: (asset: AssetRow) => void;
}

/**
 * Unified create + edit dialog for assets. Holds a `filename`, `folder`,
 * `scope`, `tags`, and a `content` editor backed by MiniEditor. Text-like
 * mimes load their existing blob into the editor on open; binary mimes hide
 * the editor with a hint pointing at the row's "Replace contents" button.
 *
 * Create flow → POST /api/assets (multipart with a synthetic File built from
 * `content`).
 * Edit flow  → PATCH /api/assets/[id] for any metadata diff, then
 *              PUT /api/assets/[id]/blob if `content` changed.
 */
export function AssetEditorDialog({
  open,
  asset,
  initialFolder,
  initialScope,
  projects,
  folders,
  onClose,
  onSaved,
}: AssetEditorDialogProps) {
  const isEditing = asset !== null;
  const [filename, setFilename] = useState("");
  const [tags, setTags] = useState("");
  const [scope, setScope] = useState("global");
  const [folder, setFolder] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [hideEditor, setHideEditor] = useState(false);
  const [hideEditorReason, setHideEditorReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reset state every time the dialog opens. For an existing asset, also fetch
  // its content if the mime is text-like and the blob fits the inline-edit cap.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (asset) {
      setFilename(asset.filename);
      setTags(asset.tags.join(", "));
      setScope(asset.scope === "global" ? "global" : asset.scope.projectId);
      setFolder(asset.folder ?? "");
      const textMime = isTextMime(asset.mime);
      if (!textMime) {
        setHideEditor(true);
        setHideEditorReason(
          `${asset.mime || "binary"} — use the row's ↻ button to replace the file contents instead.`,
        );
        setContent("");
        setOriginalContent("");
      } else if (asset.sizeBytes > MAX_EDIT_BYTES) {
        setHideEditor(true);
        setHideEditorReason(
          `File is ${formatBytes(asset.sizeBytes)} (cap is ${formatBytes(MAX_EDIT_BYTES)}); use ↻ to replace from disk.`,
        );
        setContent("");
        setOriginalContent("");
      } else {
        setHideEditor(false);
        setHideEditorReason(null);
        setContentLoading(true);
        let cancelled = false;
        fetch(`/api/assets/${asset.id}/blob`, { cache: "no-store" })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then((text) => {
            if (cancelled) return;
            setContent(text);
            setOriginalContent(text);
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            setError(e instanceof Error ? e.message : String(e));
          })
          .finally(() => {
            if (cancelled) return;
            setContentLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }
    } else {
      setFilename("");
      setTags("");
      setScope(initialScope);
      setFolder(initialFolder ?? "");
      setContent("");
      setOriginalContent("");
      setHideEditor(false);
      setHideEditorReason(null);
      // Focus the filename input on next tick so the modal has rendered.
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [open, asset, initialFolder, initialScope]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedName = filename.trim();
      const trimmedFolder = folder.trim();
      const parsedTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const targetFolder = trimmedFolder.length > 0 ? trimmedFolder : null;
      const targetScope: "global" | { projectId: string } =
        scope === "global" ? "global" : { projectId: scope };
      const mime = inferMime(trimmedName);

      if (!isEditing) {
        // Create: one multipart POST with a synthetic File.
        const blob = new File([content], trimmedName, { type: mime });
        const form = new FormData();
        form.set("file", blob);
        form.set("scope", scope);
        if (parsedTags.length > 0) form.set("tags", parsedTags.join(","));
        if (targetFolder) form.set("folder", targetFolder);
        const res = await fetch("/api/assets", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        const created = (await res.json()) as AssetRow;
        onSaved(created);
        return;
      }

      // Edit: PATCH metadata diff first, then replace blob if content changed.
      const existing = asset as AssetRow;
      const patch: Record<string, unknown> = {};
      if (trimmedName !== existing.filename) patch.filename = trimmedName;
      if (parsedTags.join(",") !== existing.tags.join(",")) patch.tags = parsedTags;
      if (JSON.stringify(targetScope) !== JSON.stringify(existing.scope)) {
        patch.scope = targetScope;
      }
      if (targetFolder !== existing.folder) patch.folder = targetFolder;

      let updated: AssetRow = existing;
      if (Object.keys(patch).length > 0) {
        const res = await fetch(`/api/assets/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        updated = (await res.json()) as AssetRow;
      }

      if (!hideEditor && content !== originalContent) {
        const blob = new File([content], updated.filename, { type: mime });
        const form = new FormData();
        form.set("file", blob);
        const res = await fetch(`/api/assets/${existing.id}/blob`, {
          method: "PUT",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        updated = (await res.json()) as AssetRow;
      }

      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const dirty =
    !isEditing ||
    content !== originalContent ||
    filename.trim() !== (asset?.filename ?? "") ||
    folder.trim() !== (asset?.folder ?? "") ||
    tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(",") !== (asset?.tags.join(",") ?? "") ||
    (scope === "global" ? "global" : scope) !==
      (asset?.scope === "global" ? "global" : asset?.scope.projectId);

  const language: SupportedLanguage = detectLanguage(filename);

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-editor-title"
        className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[min(900px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="asset-editor-title" className="text-base font-semibold text-zinc-100">
            {isEditing ? "Edit Asset" : "New Asset"}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
          >
            ✕
          </button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="asset-editor-filename" className="text-sm font-medium text-zinc-300">
                Filename
              </label>
              <input
                id="asset-editor-filename"
                ref={firstFieldRef}
                type="text"
                required
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="notes.md"
                className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="asset-editor-folder" className="text-sm font-medium text-zinc-300">
                Folder <span className="text-zinc-600">(empty = root)</span>
              </label>
              <input
                id="asset-editor-folder"
                type="text"
                list="asset-editor-folder-options"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="images/2024"
                className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <datalist id="asset-editor-folder-options">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="asset-editor-scope" className="text-sm font-medium text-zinc-300">
                Scope
              </label>
              <select
                id="asset-editor-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                <option value="global">Global</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="asset-editor-tags" className="text-sm font-medium text-zinc-300">
                Tags <span className="text-zinc-600">(comma-separated)</span>
              </label>
              <input
                id="asset-editor-tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="screenshot, draft"
                className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">Content</span>
              {contentLoading && (
                <span className="text-[11px] text-zinc-500">Loading content…</span>
              )}
            </div>
            {hideEditor ? (
              <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-800 px-4 text-center text-sm text-zinc-500">
                {hideEditorReason}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800">
                <MiniEditor
                  value={content}
                  language={language}
                  onChange={setContent}
                  height="100%"
                />
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !filename.trim() || (isEditing && !dirty)}
            >
              {submitting ? "Saving…" : isEditing ? "Save changes" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isTextMime(mime: string): boolean {
  if (!mime) return true; // empty / unknown → assume text and let the user decide
  if (mime.startsWith("text/")) return true;
  return (
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "application/yaml" ||
    mime === "application/x-yaml" ||
    mime === "application/x-sh" ||
    mime === "application/x-shellscript"
  );
}

function inferMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "md":
    case "mdx":
      return "text/markdown";
    case "ts":
    case "tsx":
      return "text/typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "text/javascript";
    case "json":
      return "application/json";
    case "yaml":
    case "yml":
      return "application/yaml";
    case "html":
    case "htm":
      return "text/html";
    case "css":
      return "text/css";
    case "xml":
      return "application/xml";
    case "sh":
      return "application/x-sh";
    case "txt":
    case "log":
      return "text/plain";
    default:
      return "text/plain";
  }
}

function detectLanguage(filename: string): SupportedLanguage {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "mdx") return "markdown";
  return "plaintext";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
