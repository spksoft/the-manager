"use client";

import type { AssetRow } from "@the-manager/persistence";
import { useMemo, useRef, useState } from "react";
import { useAssetFolders, useAssets, useProjects } from "../lib/hooks";
import { AssetEditorDialog } from "./AssetEditorDialog";
import { ErrorBanner } from "./ErrorBanner";

/**
 * Asset browser with folder grouping. Folders are a flat namespace of
 * path-like strings (managed via `/api/assets/folders`). Selecting a folder
 * filters the visible asset list and pre-selects it as the upload target.
 */
const ROOT = "__root__";

export function AssetBrowser() {
  const { data: assets, error, mutate: mutateAssets } = useAssets();
  const { data: foldersResp, mutate: mutateFolders } = useAssetFolders();
  const { data: projects } = useProjects();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [uploadScope, setUploadScope] = useState("global");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [mutationErr, setMutationErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  // Unified create+edit state: dialogOpen + editorAsset (null = create mode).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editorAsset, setEditorAsset] = useState<AssetRow | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<AssetRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const folders = foldersResp?.folders ?? [];
  const visibleAssets = useMemo(
    () => (assets ?? []).filter((a) => (a.folder ?? null) === currentFolder),
    [assets, currentFolder],
  );

  const upload = async (file: File) => {
    setUploading(true);
    setUploadErr(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("scope", uploadScope);
      if (currentFolder) form.set("folder", currentFolder);
      const res = await fetch("/api/assets", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutateAssets();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) upload(f);
  };

  const deleteAsset = async (id: string) => {
    setMutationErr(null);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutateAssets();
    } catch (e) {
      setMutationErr(e instanceof Error ? e.message : String(e));
    }
  };

  const addFolder = async () => {
    const name = window.prompt("New folder name (e.g. images/2024):");
    if (!name) return;
    setMutationErr(null);
    try {
      const res = await fetch("/api/assets/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: name.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutateFolders();
      setCurrentFolder(name.trim());
    } catch (e) {
      setMutationErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeFolder = async (folder: string) => {
    if (!window.confirm(`Remove folder "${folder}"? (only works if empty)`)) return;
    setMutationErr(null);
    try {
      const res = await fetch("/api/assets/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutateFolders();
      if (currentFolder === folder) setCurrentFolder(null);
    } catch (e) {
      setMutationErr(e instanceof Error ? e.message : String(e));
    }
  };

  // Replace blob: stash the asset, kick the hidden file input, and read the
  // file in the onChange. Keeping a single input simplifies lifecycle.
  const beginReplaceBlob = (asset: AssetRow) => {
    setReplaceTarget(asset);
    replaceInputRef.current?.click();
  };
  const onReplaceFileSelected = async (files: FileList | null) => {
    const target = replaceTarget;
    setReplaceTarget(null);
    const file = files?.[0];
    if (!target || !file) return;
    setMutationErr(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/assets/${target.id}/blob`, { method: "PUT", body: form });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutateAssets();
    } catch (e) {
      setMutationErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      // Reset the input so picking the same file again re-fires onChange.
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  };

  const copyPath = async (id: string) => {
    const url = `${window.location.origin}/api/assets/${id}/blob`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1200);
  };

  const scopeLabel = (asset: AssetRow) => {
    if (asset.scope === "global") return "global";
    if (typeof asset.scope === "object" && "projectId" in asset.scope) {
      const pid = asset.scope.projectId;
      const p = projects?.find((pr) => pr.id === pid);
      return p?.name ?? pid.slice(0, 8);
    }
    return "?";
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      {uploadErr && <ErrorBanner message={uploadErr} onDismiss={() => setUploadErr(null)} />}
      {mutationErr && <ErrorBanner message={mutationErr} onDismiss={() => setMutationErr(null)} />}
      {error && <ErrorBanner message={`Failed to load assets: ${String(error)}`} />}

      {/* Upload zone */}
      <section
        aria-label="File upload area"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-8 transition-colors ${
          dragOver ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/20"
        }`}
      >
        <span className="text-3xl text-zinc-600" aria-hidden>
          ↑
        </span>
        <p className="text-sm text-zinc-400">
          Drop files here or{" "}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-emerald-400 underline hover:text-emerald-300"
          >
            click to upload
          </button>
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          aria-label="Upload file"
        />
        <input
          ref={replaceInputRef}
          type="file"
          className="hidden"
          onChange={(e) => onReplaceFileSelected(e.target.files)}
          aria-label="Replace asset content"
        />
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <label htmlFor="upload-scope" className="flex items-center gap-1">
            Scope:
            <select
              id="upload-scope"
              value={uploadScope}
              onChange={(e) => setUploadScope(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300"
            >
              <option value="global">Global</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-zinc-700">·</span>
          <span>
            Folder: <span className="font-mono text-zinc-300">{currentFolder ?? "root"}</span>
          </span>
        </div>
        {uploading && <p className="text-xs text-zinc-500">Uploading…</p>}
      </section>

      {/* Folder bar */}
      <section aria-label="Folders" className="flex flex-wrap items-center gap-1.5">
        <FolderChip
          label="Root"
          active={currentFolder === null}
          onSelect={() => setCurrentFolder(null)}
          id={ROOT}
        />
        {folders.map((f) => (
          <FolderChip
            key={f}
            label={f}
            active={currentFolder === f}
            onSelect={() => setCurrentFolder(f)}
            onRemove={() => removeFolder(f)}
            id={f}
          />
        ))}
        <button
          type="button"
          onClick={addFolder}
          className="rounded-full border border-dashed border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          + New folder
        </button>
        <button
          type="button"
          onClick={() => {
            setEditorAsset(null);
            setDialogOpen(true);
          }}
          className="rounded-full border border-dashed border-emerald-700/50 px-2.5 py-1 text-xs text-emerald-300 hover:border-emerald-500 hover:text-emerald-200"
        >
          + New file
        </button>
      </section>

      {/* Assets list */}
      {!assets && !error && (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
            <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-800" />
          ))}
        </div>
      )}

      {assets && visibleAssets.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
          {currentFolder === null
            ? "No assets at the root — upload one above"
            : `No assets in "${currentFolder}" yet`}
        </div>
      )}

      {visibleAssets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          {visibleAssets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center gap-3 border-b border-zinc-900 px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">
                    {asset.filename}
                  </span>
                  <span className="flex-shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {scopeLabel(asset)}
                  </span>
                  {asset.folder && (
                    <span className="flex-shrink-0 rounded bg-zinc-800/40 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {asset.folder}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span>{asset.mime}</span>
                  <span>·</span>
                  <span>{formatBytes(asset.sizeBytes)}</span>
                  <span>·</span>
                  <span>{shortDate(asset.createdAt)}</span>
                  {asset.tags.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{asset.tags.join(", ")}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <a
                  href={`/api/assets/${asset.id}/blob`}
                  download={asset.filename}
                  aria-label={`Download ${asset.filename}`}
                  className="rounded p-1.5 text-zinc-500 hover:text-zinc-200"
                  title="Download"
                >
                  ↓
                </a>
                <button
                  type="button"
                  aria-label={`Copy URL for ${asset.filename}`}
                  onClick={() => copyPath(asset.id)}
                  className="rounded p-1.5 text-zinc-500 hover:text-zinc-200"
                  title="Copy URL"
                >
                  {copiedId === asset.id ? "✓" : "⎘"}
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${asset.filename}`}
                  onClick={() => {
                    setEditorAsset(asset);
                    setDialogOpen(true);
                  }}
                  className="rounded p-1.5 text-zinc-500 hover:text-zinc-200"
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={`Replace contents of ${asset.filename}`}
                  onClick={() => beginReplaceBlob(asset)}
                  className="rounded p-1.5 text-zinc-500 hover:text-zinc-200"
                  title="Replace contents"
                >
                  ↻
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${asset.filename}`}
                  onClick={() => deleteAsset(asset.id)}
                  className="rounded p-1.5 text-red-500/60 hover:text-red-400"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AssetEditorDialog
        open={dialogOpen}
        asset={editorAsset}
        initialFolder={currentFolder}
        initialScope={uploadScope}
        projects={projects ?? []}
        folders={folders}
        onClose={() => {
          setDialogOpen(false);
          setEditorAsset(null);
        }}
        onSaved={async () => {
          await Promise.all([mutateAssets(), mutateFolders()]);
          setDialogOpen(false);
          setEditorAsset(null);
        }}
      />
    </div>
  );
}

interface FolderChipProps {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}

function FolderChip({ id, label, active, onSelect, onRemove }: FolderChipProps) {
  return (
    <span
      className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-emerald-500/50 bg-emerald-500/10 text-zinc-50"
          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      <button type="button" onClick={onSelect} className="font-mono" aria-pressed={active}>
        {label}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove folder ${id}`}
          className="text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          title="Remove folder (only if empty)"
        >
          ✕
        </button>
      )}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
