"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  commitGit,
  generateCommitMessage,
  setCommitMessageDraft,
  stageGitFiles,
  unstageGitFiles,
  useGit,
  useGitFileDiff,
  useUiState,
} from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";
import { BranchBar } from "./git/BranchBar";
import { CommitCard } from "./git/CommitCard";
import { DiffViewer } from "./git/DiffViewer";
import { isStaged } from "./git/helpers";
import { InitRepoForm } from "./git/InitRepoForm";
import { LogList } from "./git/LogList";
import { WorkingTreeList } from "./git/WorkingTreeList";

interface GitTabProps {
  projectId: string;
}

type Busy = "idle" | "stage" | "generate" | "commit";

/**
 * Container for the per-project Git tab. Owns SWR + mutation orchestration;
 * pure presentation lives in `./git/*`. Action handlers always:
 *   1. clear actionError
 *   2. flip `busy`
 *   3. await the mutation
 *   4. revalidate the relevant SWR keys
 *   5. surface errors inline rather than throwing to React
 */
export function GitTab({ projectId }: GitTabProps) {
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useGit(projectId);
  const { data: uiState, patchUiState } = useUiState();
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const { data: diff, isLoading: diffLoading } = useGitFileDiff(projectId, diffPath);

  const [busy, setBusy] = useState<Busy>("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const gitKey = `/api/projects/${projectId}/git`;
  const refreshGit = () => mutate(gitKey);
  const refreshSelectedDiff = () =>
    diffPath ? mutate(`${gitKey}?diff=${encodeURIComponent(diffPath)}`) : undefined;

  const runStage = async (paths: string[], stage: boolean) => {
    if (paths.length === 0) return;
    setActionError(null);
    setBusy("stage");
    try {
      if (stage) await stageGitFiles(projectId, paths);
      else await unstageGitFiles(projectId, paths);
      await refreshGit();
      await refreshSelectedDiff();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("idle");
    }
  };

  const onGenerate = async (): Promise<string | null> => {
    setActionError(null);
    setBusy("generate");
    try {
      const { message } = await generateCommitMessage(projectId);
      return message;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy("idle");
    }
  };

  const onCommit = async (message: string): Promise<boolean> => {
    setActionError(null);
    setBusy("commit");
    try {
      await commitGit(projectId, message);
      await refreshGit();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("idle");
    }
  };

  const onPersistDraft = (message: string) => {
    void setCommitMessageDraft(patchUiState, projectId, message);
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
  const initialDraft = uiState?.commitMessageDraftByProject?.[projectId] ?? "";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <BranchBar
        branch={branch}
        ahead={status?.ahead ?? 0}
        behind={status?.behind ?? 0}
        tracking={status?.tracking ?? null}
      />

      {actionError && <ErrorBanner message={actionError} />}

      {status && status.files.length > 0 && (
        <>
          <WorkingTreeList
            files={status.files}
            selectedPath={diffPath}
            stageBusy={busy === "stage"}
            onToggleStage={(path, currentlyStaged) => void runStage([path], !currentlyStaged)}
            onSelectDiff={(path) => setDiffPath(diffPath === path ? null : path)}
            onStageAll={() => void runStage(unstagedPaths, true)}
            onUnstageAll={() => void runStage(stagedPaths, false)}
          />
          {diffPath && diff && (
            <DiffViewer
              path={diffPath}
              staged={diff.staged}
              unstaged={diff.unstaged}
              loading={diffLoading}
              onClose={() => setDiffPath(null)}
            />
          )}
          <CommitCard
            initialMessage={initialDraft}
            projectKey={projectId}
            stagedCount={stagedPaths.length}
            busy={busy === "generate" ? "generate" : busy === "commit" ? "commit" : "idle"}
            onGenerate={onGenerate}
            onCommit={onCommit}
            onPersistDraft={onPersistDraft}
          />
        </>
      )}

      {status && status.files.length === 0 && (
        <p className="text-xs text-zinc-600">Working tree clean</p>
      )}

      <LogList entries={log} />
    </div>
  );
}
