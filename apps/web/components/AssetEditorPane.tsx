"use client";

import { MiniEditor, type SupportedLanguage } from "@the-manager/editor";
import type { AssetRow, ProjectRow } from "@the-manager/persistence";
import { Button } from "@the-manager/ui";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";

const MAX_EDIT_BYTES = 1024 * 1024;

interface AssetEditorPaneProps {
  /** null = create-new draft mode; AssetRow = edit existing. */
  asset: AssetRow | null;
  /** Used to pre-fill new drafts; ignored for existing assets. */
  initialFolder: string | null;
  initialScope: string;
  projects: ProjectRow[];
  folders: string[];
  /** Fires after a successful save with the resulting asset. */
  onSaved: (asset: AssetRow) => void;
  /** Fires when the user explicitly closes the pane (X button). */
  onClose: () => void;
}

/**
 * Inline asset editor panel — the right-pane equivalent of FilesTab's editor.
 * Handles both "create a new file" (asset === null) and "edit existing" flows
 * in one component. Saves a NEW asset via POST /api/assets and PATCH+PUT for
 * existing ones, with the same blob-replace semantics as the modal version.
 */
export function AssetEditorPane({
  asset,
  initialFolder,
  initialScope,
  projects,
  folders,
  onSaved,
  onClose,
}: AssetEditorPaneProps) {
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
  const filenameRef = useRef<HTMLInputElement>(null);

  // Reset / reload when the target switches.
  useEffect(() => {
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
          `${asset.mime || "binary"} — use the row's ↻ button to replace the file from disk.`,
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
      requestAnimationFrame(() => filenameRef.current?.focus());
    }
  }, [asset, initialFolder, initialScope]);

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
    <form
      onSubmit={submit}
      className="animate-fade-in flex h-full min-h-0 flex-1 flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3"
    >
      <div className="flex flex-shrink-0 items-center gap-2">
        <input
          ref={filenameRef}
          type="text"
          required
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="filename.md"
          aria-label="Filename"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <Button
          type="submit"
          disabled={submitting || !filename.trim() || (isEditing && !dirty)}
          aria-label="Save asset"
        >
          {submitting ? "Saving…" : isEditing ? "Save" : "Create"}
        </Button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close editor"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <label className="flex items-center gap-1">
          <span>Folder</span>
          <input
            type="text"
            list="asset-pane-folder-options"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="root"
            className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200 placeholder:text-zinc-600"
          />
          <datalist id="asset-pane-folder-options">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-1">
          <span>Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            <option value="global">Global</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 items-center gap-1">
          <span>Tags</span>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="draft, screenshot"
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200 placeholder:text-zinc-600"
          />
        </label>
      </div>

      {contentLoading ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-800 text-[11px] text-zinc-500">
          Loading content…
        </div>
      ) : hideEditor ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-800 px-4 text-center text-sm text-zinc-500">
          {hideEditorReason}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800">
          <div className="absolute inset-0">
            <MiniEditor value={content} language={language} onChange={setContent} height="100%" />
          </div>
        </div>
      )}
    </form>
  );
}

function isTextMime(mime: string): boolean {
  if (!mime) return true;
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
