"use client";

import type { ProjectRow } from "@the-manager/persistence";
import type { DriverId } from "@the-manager/shared";
import { Button, cn } from "@the-manager/ui";
import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { DirectoryPickerDialog } from "./DirectoryPickerDialog";
import { ErrorBanner } from "./ErrorBanner";

interface EditProjectDialogProps {
  open: boolean;
  project: ProjectRow | null;
  onClose: () => void;
  onUpdated: (project: ProjectRow) => void;
}

const DRIVERS: { id: DriverId; label: string; ready: boolean }[] = [
  { id: "claude", label: "Claude Code", ready: true },
  { id: "codex", label: "Codex CLI", ready: false },
  { id: "gemini", label: "Gemini CLI", ready: false },
];

/**
 * Edit an existing project's name / defaultDriver / path. Changing `path`
 * causes the server to terminate the live `claude` pty for this project so
 * the next attach respawns under the new directory — the user will see a
 * `[claude exited]` line in the terminal and can re-engage normally.
 */
export function EditProjectDialog({ open, project, onClose, onUpdated }: EditProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [driver, setDriver] = useState<DriverId>("claude");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reset fields whenever the dialog re-opens against a (possibly different) project.
  useEffect(() => {
    if (open && project) {
      setName(project.name);
      setPath(project.path);
      setDriver(project.defaultDriver);
      setError(null);
      firstFieldRef.current?.focus();
    }
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const browse = async () => {
    if (typeof window !== "undefined" && window.theManager) {
      const dir = await window.theManager.pickDirectory();
      if (dir) setPath(dir);
      return;
    }
    setBrowserOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setError(null);
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      const trimmedPath = path.trim();
      const patch: Record<string, unknown> = {};
      if (trimmedName !== project.name) patch.name = trimmedName;
      if (trimmedPath !== project.path) patch.path = trimmedPath;
      if (driver !== project.defaultDriver) patch.defaultDriver = driver;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as ProjectRow;
      await Promise.all([mutate("/api/projects"), mutate(`/api/projects/${project.id}`)]);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !project) return null;

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
        aria-labelledby="edit-project-title"
        className="animate-scale-in fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="edit-project-title" className="text-base font-semibold text-zinc-100">
            Edit Project
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

        <form onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-project-name" className="text-sm font-medium text-zinc-300">
              Name
            </label>
            <input
              id="edit-project-name"
              ref={firstFieldRef}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-project-path" className="text-sm font-medium text-zinc-300">
              Absolute path
            </label>
            <div className="flex gap-2">
              <input
                id="edit-project-path"
                type="text"
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <Button type="button" variant="ghost" onClick={browse}>
                Browse…
              </Button>
            </div>
            {path.trim() !== project.path && (
              <p className="text-[11px] text-amber-400">
                Changing the path ends the live Claude session for this project — it will respawn
                under the new directory on next interaction.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span id="edit-project-driver-label" className="text-sm font-medium text-zinc-300">
              Default driver
            </span>
            <div
              role="radiogroup"
              aria-labelledby="edit-project-driver-label"
              className="flex gap-2"
            >
              {DRIVERS.map((d) => (
                // biome-ignore lint/a11y/useSemanticElements: visual segmented button — matches NewProjectDialog
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={driver === d.id}
                  aria-disabled={!d.ready}
                  disabled={!d.ready}
                  onClick={() => d.ready && setDriver(d.id)}
                  title={d.ready ? undefined : "Coming soon — only Claude is wired today"}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors",
                    !d.ready && "cursor-not-allowed opacity-40",
                    driver === d.id && d.ready
                      ? "border-emerald-500/40 bg-emerald-500/10 text-zinc-50"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !path.trim()}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
      <DirectoryPickerDialog
        open={browserOpen}
        initialPath={path}
        onCancel={() => setBrowserOpen(false)}
        onPick={(p) => {
          setPath(p);
          setBrowserOpen(false);
        }}
      />
    </>
  );
}
