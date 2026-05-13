"use client";

import { cn } from "@the-manager/ui";
import { useState } from "react";
import { initGit } from "../../lib/hooks";
import { ErrorBanner } from "../ErrorBanner";

interface InitRepoFormProps {
  projectId: string;
  onInitialized: () => void;
}

export function InitRepoForm({ projectId, onInitialized }: InitRepoFormProps) {
  const [remoteUrl, setRemoteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onInit = async () => {
    setError(null);
    setBusy(true);
    try {
      await initGit(projectId, remoteUrl);
      setRemoteUrl("");
      onInitialized();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <p className="text-sm text-zinc-400">Not a git repository</p>
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <label className="flex flex-col gap-1.5 text-[11px] text-zinc-500">
          <span className="font-semibold uppercase tracking-wider">
            Remote URL <span className="font-normal normal-case text-zinc-600">(optional)</span>
          </span>
          <input
            type="text"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="git@github.com:owner/repo.git"
            disabled={busy}
            className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus:border-zinc-700 focus:outline-none"
          />
          <span className="text-[10px] text-zinc-600">
            If set, added as `origin` after init. You can push later from the agent terminal.
          </span>
        </label>
        {error && <ErrorBanner message={error} />}
        <button
          type="button"
          onClick={() => void onInit()}
          disabled={busy}
          className={cn(
            "self-end rounded px-3 py-1 text-xs font-medium transition-colors",
            busy ? "bg-zinc-800 text-zinc-600" : "bg-emerald-600 text-white hover:bg-emerald-500",
          )}
        >
          {busy ? "Initializing…" : "Initialize repository"}
        </button>
      </div>
    </div>
  );
}
