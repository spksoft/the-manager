"use client";

import type { ProjectRow } from "@the-manager/persistence";
import type { DriverId } from "@the-manager/shared";
import { Button, cn } from "@the-manager/ui";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectRow) => void;
}

// Claude is the only driver wired to the chat runtime today (claude -p with
// stream-json). Codex/Gemini are listed so users can see the roadmap, but
// they're disabled until each gets a print-mode driver.
const DRIVERS: { id: DriverId; label: string; ready: boolean }[] = [
  { id: "claude", label: "Claude Code", ready: true },
  { id: "codex", label: "Codex CLI", ready: false },
  { id: "gemini", label: "Gemini CLI", ready: false },
];

export function NewProjectDialog({ open, onClose, onCreated }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [driver, setDriver] = useState<DriverId>("claude");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Focus first field when opened
  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  // Close on Esc
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
    }
  };

  const hasBridge = typeof window !== "undefined" && Boolean(window.theManager);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), path: path.trim(), defaultDriver: driver }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const project = (await res.json()) as ProjectRow;
      setName("");
      setPath("");
      setDriver("claude");
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="new-project-title" className="text-base font-semibold text-zinc-100">
            Register Project
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

        <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-5">
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-project-name" className="text-sm font-medium text-zinc-300">
              Name
            </label>
            <input
              id="new-project-name"
              ref={firstFieldRef}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-project-path" className="text-sm font-medium text-zinc-300">
              Absolute path
            </label>
            <div className="flex gap-2">
              <input
                id="new-project-path"
                type="text"
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/home/user/projects/my-project"
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              {hasBridge && (
                <Button type="button" variant="ghost" onClick={browse}>
                  Browse…
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span id="new-project-driver-label" className="text-sm font-medium text-zinc-300">
              Default driver
            </span>
            <div
              role="radiogroup"
              aria-labelledby="new-project-driver-label"
              className="flex gap-2"
            >
              {DRIVERS.map((d) => (
                // biome-ignore lint/a11y/useSemanticElements: visual segmented button — a native <input type=radio> can't render this layout without significantly more CSS reset work.
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
                  {!d.ready && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
                      soon
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !path.trim()}>
              {submitting ? "Adding…" : "Add project"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
