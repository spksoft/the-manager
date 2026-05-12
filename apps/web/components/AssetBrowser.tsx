"use client";

import type { AssetRow } from "@the-manager/persistence";
import { useRef, useState } from "react";
import { useAssets, useProjects } from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";

export function AssetBrowser() {
  const { data: assets, error, mutate } = useAssets();
  const { data: projects } = useProjects();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadScope, setUploadScope] = useState("global");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadErr(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("scope", uploadScope);
      const res = await fetch("/api/assets", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutate();
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
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutate();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    }
  };

  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Copies a fetchable URL the user can paste into curl, an agent prompt, etc.
  // It's a real URL backed by the assets blob route, not a made-up scheme.
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
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {uploadErr && <ErrorBanner message={uploadErr} onDismiss={() => setUploadErr(null)} />}
      {deleteErr && <ErrorBanner message={deleteErr} onDismiss={() => setDeleteErr(null)} />}
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
        {/* Scope selector */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <label htmlFor="upload-scope">Scope:</label>
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
        </div>
        {uploading && <p className="text-xs text-zinc-500">Uploading…</p>}
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

      {assets && assets.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
          No assets yet — upload one above
        </div>
      )}

      {assets && assets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          {assets.map((asset) => (
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
                >
                  ↓
                </a>
                <button
                  type="button"
                  aria-label={`Copy URL for ${asset.filename}`}
                  onClick={() => copyPath(asset.id)}
                  className="rounded p-1.5 text-zinc-500 hover:text-zinc-200"
                >
                  {copiedId === asset.id ? "✓" : "⎘"}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${asset.filename}`}
                  onClick={() => deleteAsset(asset.id)}
                  className="rounded p-1.5 text-red-500/60 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
