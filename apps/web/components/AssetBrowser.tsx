"use client";

import type { AssetRow } from "@the-manager/persistence";
import { Sheet } from "@the-manager/ui";
import { useMemo, useRef, useState } from "react";
import { useAssetFolders, useAssets, useProjects } from "../lib/hooks";
import { AssetEditorPane } from "./AssetEditorPane";
import { ErrorBanner } from "./ErrorBanner";

/**
 * Asset browser laid out like FilesTab: left rail = folders + asset list,
 * right pane = inline editor for the selected asset (or a draft new file).
 * Upload still works via the file picker / drag-drop at the top of the left
 * rail; everything else happens in-pane — no modal dialogs.
 */
type Selection = { kind: "asset"; id: string } | { kind: "new" } | null;

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
  const [selection, setSelection] = useState<Selection>(null);
  const [replaceTarget, setReplaceTarget] = useState<AssetRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  const folders = foldersResp?.folders ?? [];
  const visibleAssets = useMemo(
    () => (assets ?? []).filter((a) => (a.folder ?? null) === currentFolder),
    [assets, currentFolder],
  );
  const selectedAsset =
    selection?.kind === "asset"
      ? ((assets ?? []).find((a) => a.id === selection.id) ?? null)
      : null;

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
      if (selection?.kind === "asset" && selection.id === id) setSelection(null);
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

  const selectAsset = (id: string) => {
    setSelection({ kind: "asset", id });
    setRailOpen(false);
  };
  const startNew = () => {
    setSelection({ kind: "new" });
    setRailOpen(false);
  };

  const rail = (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {uploadErr && <ErrorBanner message={uploadErr} onDismiss={() => setUploadErr(null)} />}
      {mutationErr && <ErrorBanner message={mutationErr} onDismiss={() => setMutationErr(null)} />}
      {error && <ErrorBanner message={`Failed to load assets: ${String(error)}`} />}

      {/* Upload + new-file row */}
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
        className={`flex flex-col gap-2 rounded-md border border-dashed px-3 py-3 text-xs transition-colors ${
          dragOver ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-800 bg-zinc-950/40"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-emerald-400 underline-offset-2 hover:underline"
          >
            Upload…
          </button>
          <button
            type="button"
            onClick={startNew}
            className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            + New file
          </button>
        </div>
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
        <label className="flex items-center gap-1 text-[11px] text-zinc-500">
          <span>Scope</span>
          <select
            value={uploadScope}
            onChange={(e) => setUploadScope(e.target.value)}
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300"
          >
            <option value="global">Global</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {uploading && <p className="text-[11px] text-zinc-500">Uploading…</p>}
      </section>

      {/* Folder list */}
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Folders
          </span>
          <button
            type="button"
            onClick={addFolder}
            aria-label="New folder"
            className="text-zinc-500 hover:text-zinc-200"
            title="New folder"
          >
            +
          </button>
        </div>
        <ul className="flex flex-col gap-0.5">
          <FolderRow
            label="Root"
            active={currentFolder === null}
            onSelect={() => setCurrentFolder(null)}
          />
          {folders.map((f) => (
            <FolderRow
              key={f}
              label={f}
              active={currentFolder === f}
              onSelect={() => setCurrentFolder(f)}
              onRemove={() => removeFolder(f)}
            />
          ))}
        </ul>
      </section>

      {/* Asset list in current folder */}
      <section className="flex min-h-0 flex-1 flex-col gap-1">
        <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {currentFolder === null ? "Root" : currentFolder} ({visibleAssets.length})
        </span>
        {!assets && !error && (
          <div className="flex flex-col gap-2 px-1">
            {[...Array(3)].map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
              <div key={i} className="h-7 animate-pulse rounded bg-zinc-800" />
            ))}
          </div>
        )}
        {assets && visibleAssets.length === 0 && (
          <p className="px-1 text-[11px] text-zinc-600">No assets in this folder yet.</p>
        )}
        <ul className="flex flex-col gap-0.5">
          {visibleAssets.map((asset) => {
            const isSel = selection?.kind === "asset" && selection.id === asset.id;
            return (
              <li key={asset.id} className="group">
                <div
                  className={`flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors ${
                    isSel ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectAsset(asset.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-pressed={isSel}
                  >
                    <div className="truncate text-xs text-zinc-200">{asset.filename}</div>
                    <div className="truncate text-[10px] text-zinc-500">
                      {scopeLabel(asset)} · {formatBytes(asset.sizeBytes)}
                    </div>
                  </button>
                  <span className="flex flex-shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                    <a
                      href={`/api/assets/${asset.id}/blob`}
                      download={asset.filename}
                      aria-label={`Download ${asset.filename}`}
                      title="Download"
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                    >
                      ↓
                    </a>
                    <button
                      type="button"
                      aria-label={`Copy URL for ${asset.filename}`}
                      onClick={() => copyPath(asset.id)}
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                      title="Copy URL"
                    >
                      {copiedId === asset.id ? "✓" : "⎘"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Replace contents of ${asset.filename}`}
                      onClick={() => beginReplaceBlob(asset)}
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                      title="Replace contents"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${asset.filename}`}
                      onClick={() => deleteAsset(asset.id)}
                      className="rounded p-0.5 text-red-500/60 hover:text-red-400"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 md:flex-row md:gap-3">
      {/* Left rail — column on md+, Sheet on mobile */}
      <div className="hidden w-72 flex-shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30 md:block">
        {rail}
      </div>

      <Sheet open={railOpen} onOpenChange={setRailOpen} side="left" ariaLabel="Assets">
        {rail}
      </Sheet>

      {/* Mobile toolbar: only on <md */}
      <div className="flex flex-shrink-0 items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          aria-label="Open asset list"
          className="flex h-8 items-center gap-1 rounded-md border border-zinc-800 px-2 text-xs text-zinc-300 hover:bg-zinc-800/60"
        >
          <span aria-hidden>☰</span> Assets
        </button>
        <span className="truncate text-[11px] text-zinc-500">
          {currentFolder === null ? "Root" : currentFolder} · {visibleAssets.length}
        </span>
      </div>

      {/* Right pane: inline editor or empty state */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selection === null ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-800 px-4 text-center text-sm text-zinc-600">
            <span className="md:hidden">Tap "Assets" to pick a file, or upload one.</span>
            <span className="hidden md:inline">
              Select an asset to view or edit, or click "+ New file".
            </span>
          </div>
        ) : (
          <AssetEditorPane
            asset={selectedAsset}
            initialFolder={currentFolder}
            initialScope={uploadScope}
            projects={projects ?? []}
            folders={folders}
            onSaved={async (saved) => {
              await Promise.all([mutateAssets(), mutateFolders()]);
              setSelection({ kind: "asset", id: saved.id });
            }}
            onClose={() => setSelection(null)}
          />
        )}
      </div>
    </div>
  );
}

interface FolderRowProps {
  label: string;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}

function FolderRow({ label, active, onSelect, onRemove }: FolderRowProps) {
  return (
    <li className="group">
      <div
        className={`flex items-center gap-1 rounded px-1.5 py-1 transition-colors ${
          active ? "bg-zinc-800/80 text-zinc-50" : "text-zinc-400 hover:bg-zinc-800/40"
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 truncate text-left text-xs"
          aria-pressed={active}
        >
          <span aria-hidden className="mr-1 text-zinc-600">
            ▣
          </span>
          {label}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove folder ${label}`}
            className="rounded p-0.5 text-zinc-600 transition-opacity hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
            title="Remove (only if empty)"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
