"use client";

import { cn } from "@the-manager/ui";
import { useEffect, useState } from "react";

interface CommitCardProps {
  /** Initial draft from persisted UiState. Re-applied when `projectKey` changes. */
  initialMessage: string;
  /** Changes when the active project changes; remounts message state. */
  projectKey: string;
  stagedCount: number;
  busy: "idle" | "generate" | "commit";
  onGenerate: () => Promise<string | null>;
  onCommit: (message: string) => Promise<boolean>;
  /** Called on blur with the current draft so it can be persisted to UiState. */
  onPersistDraft: (message: string) => void;
}

export function CommitCard({
  initialMessage,
  projectKey,
  stagedCount,
  busy,
  onGenerate,
  onCommit,
  onPersistDraft,
}: CommitCardProps) {
  const [message, setMessage] = useState(initialMessage);

  // Re-hydrate when switching projects. We don't sync on every parent update
  // because that would clobber the user's in-progress typing if the SWR poll
  // happens to land mid-keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on projectKey only
  useEffect(() => {
    setMessage(initialMessage);
  }, [projectKey]);

  const hasStaged = stagedCount > 0;
  const canCommit = hasStaged && message.trim().length > 0 && busy !== "commit";

  const handleGenerate = async () => {
    const generated = await onGenerate();
    if (generated != null) {
      setMessage(generated);
      onPersistDraft(generated);
    }
  };

  const handleCommit = async () => {
    const ok = await onCommit(message);
    if (ok) {
      setMessage("");
      onPersistDraft("");
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Commit ({stagedCount} staged)
        </h3>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={busy === "generate"}
          className="text-[11px] text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600"
          title="Draft a commit message from the staged diff using claude -p"
        >
          {busy === "generate" ? "Generating…" : "✨ Generate with Claude"}
        </button>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onBlur={() => onPersistDraft(message)}
        placeholder="Commit message (subject line, then blank line, then optional body)"
        rows={4}
        className="resize-y rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-600">
          {hasStaged
            ? `Will commit ${stagedCount} file${stagedCount === 1 ? "" : "s"}`
            : "Nothing staged yet"}
        </span>
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={!canCommit}
          className={cn(
            "rounded px-3 py-1 text-xs font-medium transition-colors",
            canCommit
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : "bg-zinc-800 text-zinc-600",
          )}
        >
          {busy === "commit" ? "Committing…" : "Commit"}
        </button>
      </div>
    </section>
  );
}
