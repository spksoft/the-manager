"use client";

import { cn } from "@the-manager/ui";
import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  commitGit,
  generateCommitMessage,
  initGit,
  stageGitFiles,
  unstageGitFiles,
  useGit,
  useGitFileDiff,
} from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";

interface GitTabProps {
  projectId: string;
}

/**
 * `index` (the porcelain "X" column) reads as ' ' (unchanged in index),
 * '?' (untracked), or a single letter for staged adds/mods/deletes/renames.
 * Anything other than space/question-mark/empty means "this file has staged
 * changes" — and that's what drives the checkbox state in the UI.
 */
function isStaged(index: string): boolean {
  const c = index;
  return c !== "" && c !== " " && c !== "?";
}

export function GitTab({ projectId }: GitTabProps) {
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useGit(projectId);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const { data: diff, isLoading: diffLoading } = useGitFileDiff(projectId, diffPath);

  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState<"idle" | "stage" | "generate" | "commit">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const gitKey = `/api/projects/${projectId}/git`;
  const refreshGit = () => mutate(gitKey);

  const toggleStage = async (path: string, currentlyStaged: boolean) => {
    setActionError(null);
    setBusy("stage");
    try {
      if (currentlyStaged) await unstageGitFiles(projectId, [path]);
      else await stageGitFiles(projectId, [path]);
      await refreshGit();
      // If the diff pane is open on this file, refresh it too — staging
      // changes which half of the diff has content.
      if (diffPath === path) {
        await mutate(`${gitKey}?diff=${encodeURIComponent(path)}`);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("idle");
    }
  };

  const stageAll = async (paths: string[], stage: boolean) => {
    if (paths.length === 0) return;
    setActionError(null);
    setBusy("stage");
    try {
      if (stage) await stageGitFiles(projectId, paths);
      else await unstageGitFiles(projectId, paths);
      await refreshGit();
      if (diffPath) await mutate(`${gitKey}?diff=${encodeURIComponent(diffPath)}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("idle");
    }
  };

  const onGenerate = async () => {
    setActionError(null);
    setBusy("generate");
    try {
      const { message } = await generateCommitMessage(projectId);
      setCommitMessage(message);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("idle");
    }
  };

  const onCommit = async () => {
    setActionError(null);
    setBusy("commit");
    try {
      await commitGit(projectId, commitMessage);
      setCommitMessage("");
      await refreshGit();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("idle");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
          <div key={i} className="h-6 animate-pulse rounded bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error) return <ErrorBanner message={`Git error: ${String(error)}`} />;

  if (!data) return null;

  if (!data.isRepo) {
    return <InitRepoForm projectId={projectId} onInitialized={() => void refreshGit()} />;
  }

  const { branch, status, log } = data;
  const stagedPaths = status?.files.filter((f) => isStaged(f.index)).map((f) => f.path) ?? [];
  const unstagedPaths = status?.files.filter((f) => !isStaged(f.index)).map((f) => f.path) ?? [];
  const hasStaged = stagedPaths.length > 0;
  const canCommit = hasStaged && commitMessage.trim().length > 0 && busy !== "commit";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* Branch info */}
      <section className="flex flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-zinc-100">
            {branch ?? <span className="text-zinc-500">no commits yet</span>}
          </span>
          {status && (
            <div className="flex gap-2 text-xs text-zinc-500">
              {status.ahead > 0 && <span className="text-emerald-400">↑{status.ahead}</span>}
              {status.behind > 0 && <span className="text-amber-400">↓{status.behind}</span>}
              {status.tracking && <span className="text-zinc-500">tracking {status.tracking}</span>}
            </div>
          )}
        </div>
      </section>

      {actionError && <ErrorBanner message={actionError} />}

      {/* Status files */}
      {status && status.files.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Working tree ({status.files.length})
            </h3>
            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => void stageAll(unstagedPaths, true)}
                disabled={unstagedPaths.length === 0 || busy === "stage"}
                className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700"
              >
                Stage all
              </button>
              <span className="text-zinc-700">·</span>
              <button
                type="button"
                onClick={() => void stageAll(stagedPaths, false)}
                disabled={stagedPaths.length === 0 || busy === "stage"}
                className="text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700"
              >
                Unstage all
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {status.files.map((f) => {
              const selected = diffPath === f.path;
              const staged = isStaged(f.index);
              return (
                <div
                  key={f.path}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-zinc-900 px-3 py-1.5 last:border-0",
                    selected ? "bg-zinc-800/70" : "hover:bg-zinc-900/60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={staged}
                    disabled={busy === "stage"}
                    onChange={() => void toggleStage(f.path, staged)}
                    aria-label={staged ? `Unstage ${f.path}` : `Stage ${f.path}`}
                    className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setDiffPath(selected ? null : f.path)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-expanded={selected}
                    aria-label={`Toggle diff for ${f.path}`}
                  >
                    <StatusCode index={f.index} working={f.working_dir} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">
                      {f.path}
                    </span>
                    <span className="flex-shrink-0 text-[10px] text-zinc-600">
                      {selected ? "▾" : "▸"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {diffPath && (
            <div className="animate-slide-up overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
                <span className="font-mono text-[11px] text-zinc-300">{diffPath}</span>
                <button
                  type="button"
                  onClick={() => setDiffPath(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  aria-label="Close diff view"
                >
                  Close
                </button>
              </div>
              {diffLoading && (
                <div className="px-3 py-2 text-[11px] text-zinc-500">Loading diff…</div>
              )}
              {!diffLoading && diff && <DiffPanes staged={diff.staged} unstaged={diff.unstaged} />}
            </div>
          )}
        </section>
      )}

      {status && status.files.length === 0 && (
        <p className="text-xs text-zinc-600">Working tree clean</p>
      )}

      {/* Commit form */}
      {status && status.files.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Commit ({stagedPaths.length} staged)
            </h3>
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={busy === "generate"}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600"
              title="Draft a commit message from the staged diff using claude -p"
            >
              {busy === "generate" ? "Generating…" : "✨ Generate with Claude"}
            </button>
          </div>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message (subject line, then blank line, then optional body)"
            rows={4}
            className="resize-y rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">
              {hasStaged
                ? `Will commit ${stagedPaths.length} file${stagedPaths.length === 1 ? "" : "s"}`
                : "Nothing staged yet"}
            </span>
            <button
              type="button"
              onClick={() => void onCommit()}
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
      )}

      {/* Log */}
      {log.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Recent commits
          </h3>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {log.slice(0, 20).map((entry) => (
              <div
                key={entry.hash}
                className="flex items-baseline gap-2 border-b border-zinc-900 px-3 py-1.5 last:border-0 md:gap-3"
              >
                <span className="w-14 flex-shrink-0 font-mono text-[11px] text-zinc-500">
                  {entry.hash.slice(0, 7)}
                </span>
                <span className="hidden w-28 flex-shrink-0 text-[11px] text-zinc-500 md:inline">
                  {shortDate(entry.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                  {entry.message}
                </span>
                <span className="hidden flex-shrink-0 text-[11px] text-zinc-500 md:inline">
                  {entry.author}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DiffPanes({ staged, unstaged }: { staged: string; unstaged: string }) {
  const hasStaged = staged.trim().length > 0;
  const hasUnstaged = unstaged.trim().length > 0;
  if (!hasStaged && !hasUnstaged) {
    return (
      <div className="px-3 py-3 text-[11px] text-zinc-500">
        No diff against HEAD — likely a brand-new untracked file. Stage it to see a diff.
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {hasUnstaged && <DiffBlock label="Unstaged" body={unstaged} />}
      {hasStaged && <DiffBlock label="Staged" body={staged} />}
    </div>
  );
}

function DiffBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="border-b border-zinc-900 last:border-0">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] leading-relaxed">
        {body.split("\n").map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional; index is the natural key
          <DiffLine key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  let cls = "text-zinc-400";
  if (line.startsWith("+++") || line.startsWith("---")) cls = "text-zinc-500";
  else if (line.startsWith("@@")) cls = "text-cyan-400";
  else if (line.startsWith("+")) cls = "text-emerald-300";
  else if (line.startsWith("-")) cls = "text-red-300";
  else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-zinc-600";
  return <span className={`block whitespace-pre ${cls}`}>{line || " "}</span>;
}

function StatusCode({ index, working }: { index: string; working: string }) {
  const staged = index.trim() !== "" && index !== "?";
  const modified = working.trim() !== "" && working !== "?";
  const untracked = index === "?" || working === "?";

  return (
    <span className="flex w-6 gap-0.5 font-mono text-[11px]">
      <span className={cn("w-3", staged ? "text-emerald-400" : "text-zinc-700")}>
        {index || " "}
      </span>
      <span
        className={cn(
          "w-3",
          untracked ? "text-zinc-500" : modified ? "text-amber-400" : "text-zinc-700",
        )}
      >
        {working || " "}
      </span>
    </span>
  );
}

function InitRepoForm({
  projectId,
  onInitialized,
}: {
  projectId: string;
  onInitialized: () => void;
}) {
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

function shortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr.slice(0, 10);
  }
}
