"use client";

import { Sheet } from "@the-manager/ui";
import { XIcon } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import {
  checkoutBranch,
  commitGit,
  createBranch,
  deleteBranch,
  generateCommitMessage,
  makeGitInvalidator,
  type RemoteOpBody,
  type RemoteOpHandle,
  renameBranch,
  runMerge,
  runReset,
  setBranchUpstream,
  setCommitMessageDraft,
  stageGitFiles,
  stageHunk,
  stashApply,
  stashDrop,
  stashSave,
  streamRemoteOp,
  unstageGitFiles,
  unstageHunk,
  useCommit,
  useCommitFileDiff,
  useGit,
  useGitFileDiff,
  useUiState,
} from "../../lib/hooks";
import { ErrorBanner } from "../ErrorBanner";
import { CommitCard } from "./CommitCard";
import { CommitFileList } from "./center/CommitFileList";
import { CommitGraph } from "./center/CommitGraph";
import { TopBar } from "./center/TopBar";
import { CheckoutDirtyDialog } from "./dialogs/CheckoutDirtyDialog";
import { CreateBranchDialog } from "./dialogs/CreateBranchDialog";
import { DeleteBranchDialog } from "./dialogs/DeleteBranchDialog";
import { ForcePushDialog } from "./dialogs/ForcePushDialog";
import { MergeDialog } from "./dialogs/MergeDialog";
import { RenameBranchDialog } from "./dialogs/RenameBranchDialog";
import { ResetDialog } from "./dialogs/ResetDialog";
import { StashSaveDialog } from "./dialogs/StashSaveDialog";
import { type DialogState, type GitActions, GitActionsProvider } from "./GitActionsContext";
import { isStaged, useIsMobile } from "./helpers";
import { Sidebar } from "./left/Sidebar";
import { CommitDetailsHeader } from "./right/CommitDetailsHeader";
import { HunkDiffViewer } from "./right/HunkDiffViewer";
import { PlainDiffViewer } from "./right/PlainDiffViewer";
import { WorkingTreeList } from "./WorkingTreeList";

interface GitWorkspaceProps {
  projectId: string;
}

export type Selection =
  | { kind: "working-tree"; path: string | null }
  | { kind: "commit"; hash: string; path: string | null };

interface ViewState {
  selection: Selection;
  diffMode: "unified" | "split";
  busy: Set<string>;
  progress: { method: string; stage: string; pct: number } | null;
}

type ViewAction =
  | { type: "select"; selection: Selection }
  | { type: "setBusy"; tag: string; on: boolean }
  | { type: "setDiffMode"; mode: "unified" | "split" }
  | { type: "setProgress"; progress: ViewState["progress"] };

function reducer(s: ViewState, a: ViewAction): ViewState {
  switch (a.type) {
    case "select":
      return { ...s, selection: a.selection };
    case "setBusy": {
      const next = new Set(s.busy);
      if (a.on) next.add(a.tag);
      else next.delete(a.tag);
      return { ...s, busy: next };
    }
    case "setDiffMode":
      return { ...s, diffMode: a.mode };
    case "setProgress":
      return { ...s, progress: a.progress };
  }
}

const INITIAL: ViewState = {
  selection: { kind: "working-tree", path: null },
  diffMode: "unified",
  busy: new Set(),
  progress: null,
};

/**
 * Three-pane Git workspace. Left: branches/stash/remotes/tags. Center: working
 * tree + commit graph. Right: diff pane and commit-details header.
 */
export function GitWorkspace({ projectId }: GitWorkspaceProps) {
  const { mutate } = useSWRConfig();
  const invalidate = makeGitInvalidator(projectId, mutate as (k: string) => Promise<unknown>);
  const { data, error } = useGit(projectId);
  const { data: uiState, patchUiState } = useUiState();
  const [view, dispatch] = useReducer(reducer, INITIAL);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const isMobile = useIsMobile();
  const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const sel = view.selection;
  const wtPath = sel.kind === "working-tree" ? sel.path : null;
  const commitHash = sel.kind === "commit" ? sel.hash : null;
  const commitPath = sel.kind === "commit" ? sel.path : null;

  const { data: wtDiff, isLoading: wtDiffLoading } = useGitFileDiff(projectId, wtPath);
  const { data: commit, isLoading: commitLoading } = useCommit(projectId, commitHash);
  const { data: commitDiff, isLoading: commitDiffLoading } = useCommitFileDiff(
    projectId,
    commitHash,
    commitPath,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const setBusy = (tag: string, on: boolean) => dispatch({ type: "setBusy", tag, on });

  const wrap = async <T,>(tag: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setActionError(null);
    setBusy(tag, true);
    try {
      return await fn();
    } catch (e) {
      // Surface DIRTY_TREE specially: if it's a checkout, open the dialog.
      const err = e as { code?: string; details?: { dirty?: unknown }; message?: string };
      if (err.code === "DIRTY_TREE" && tag.startsWith("checkout:")) {
        const target = tag.slice("checkout:".length);
        const dirty =
          (err.details?.dirty as DialogState extends { id: "checkout-dirty" }
            ? never
            : { path: string; index: string; working_dir: string }[]) ?? [];
        setDialog({ id: "checkout-dirty", target, dirty });
        return undefined;
      }
      setActionError(err.message ?? String(e));
      return undefined;
    } finally {
      setBusy(tag, false);
    }
  };

  // Action wrappers for context. Re-created each render; cheap because
  // consumers read individual properties and don't compare object identity.
  const actions: GitActions = {
    currentBranch: data?.branch ?? null,
    commitDetails: commit ?? null,
    checkout: async (name) => {
      await wrap(`checkout:${name}`, async () => {
        await checkoutBranch(projectId, name, false);
        await invalidate({ git: true, branches: true, graph: true });
      });
    },
    openCreateBranch: (startPoint, startPointLabel) =>
      setDialog({ id: "create-branch", startPoint, startPointLabel }),
    openDeleteBranch: (name, remote) => setDialog({ id: "delete-branch", name, remote }),
    openRenameBranch: (from) => setDialog({ id: "rename-branch", from }),
    setUpstream: async (branch, upstream) => {
      await wrap("set-upstream", async () => {
        await setBranchUpstream(projectId, branch, upstream);
        await invalidate({ git: true, branches: true });
      });
    },
    openStashSave: () => setDialog({ id: "stash-save" }),
    stashApply: async (index, pop) => {
      await wrap("stash-apply", async () => {
        await stashApply(projectId, index, pop);
        await invalidate({ git: true, stash: true, graph: true });
      });
    },
    stashDrop: async (index) => {
      await wrap("stash-drop", async () => {
        await stashDrop(projectId, index);
        await invalidate({ stash: true });
      });
    },
    openReset: (target, subject) => setDialog({ id: "reset", target, targetSubject: subject }),
    openMerge: (branch) => setDialog({ id: "merge", branch }),
    openResetForNode: (node) =>
      setDialog({ id: "reset", target: node.hash, targetSubject: node.subject }),
    openCreateBranchFromCommit: (node) =>
      setDialog({
        id: "create-branch",
        startPoint: node.hash,
        startPointLabel: `${node.hash.slice(0, 7)} ${node.subject}`,
      }),
  };

  const runStage = async (paths: string[], stage: boolean) => {
    if (paths.length === 0) return;
    await wrap("stage", async () => {
      if (stage) await stageGitFiles(projectId, paths);
      else await unstageGitFiles(projectId, paths);
      await invalidate({ git: true, diff: wtPath, graph: true });
    });
  };

  const onGenerate = async (): Promise<string | null> => {
    setActionError(null);
    setBusy("generate", true);
    try {
      const { message } = await generateCommitMessage(projectId);
      return message;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy("generate", false);
    }
  };

  const onCommit = async (message: string): Promise<boolean> => {
    const r = await wrap("commit", async () => {
      await commitGit(projectId, message);
      await invalidate({ git: true, branches: true, graph: true });
      return true;
    });
    return r === true;
  };

  const onPersistDraft = (message: string) => {
    void setCommitMessageDraft(patchUiState, projectId, message);
  };

  // Remote op (fetch/pull/push) — single in-flight at a time. Keep a ref to
  // the active handle so the Cancel button can SIGINT the underlying git.
  const remoteHandleRef = useRef<RemoteOpHandle | null>(null);
  const runRemoteOp = (body: RemoteOpBody) => {
    if (remoteHandleRef.current) return; // already running
    setActionError(null);
    setBusy(`remote:${body.action}`, true);
    dispatch({
      type: "setProgress",
      progress: { method: body.action, stage: "starting…", pct: 0 },
    });
    remoteHandleRef.current = streamRemoteOp(projectId, body, {
      onProgress: (e) => {
        dispatch({
          type: "setProgress",
          progress: { method: body.action, stage: e.stage, pct: e.progress },
        });
      },
      onDone: () => {
        void invalidate({ git: true, branches: true, graph: true });
      },
      onError: (m) => setActionError(m),
    });
    void remoteHandleRef.current.finished.then(() => {
      remoteHandleRef.current = null;
      setBusy(`remote:${body.action}`, false);
      dispatch({ type: "setProgress", progress: null });
    });
  };
  const cancelRemoteOp = () => {
    remoteHandleRef.current?.cancel();
  };

  // Mobile UX: auto-open the detail sheet when the user picks a working-tree
  // file or a commit. The right-pane content isn't visible inline on phones,
  // so the sheet stands in for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tracked via primitives
  useEffect(() => {
    if (!isMobile) return;
    const hasContent = (sel.kind === "working-tree" && sel.path !== null) || sel.kind === "commit";
    if (hasContent) setMobileDetailOpen(true);
  }, [
    isMobile,
    sel.kind,
    sel.kind === "working-tree" ? sel.path : null,
    sel.kind === "commit" ? sel.hash : null,
  ]);

  const closeMobileDetail = () => {
    setMobileDetailOpen(false);
    // Clear the path so re-tapping the same file/commit re-opens the sheet.
    if (sel.kind === "working-tree" && sel.path !== null) {
      dispatch({ type: "select", selection: { kind: "working-tree", path: null } });
    } else if (sel.kind === "commit") {
      dispatch({ type: "select", selection: { kind: "working-tree", path: null } });
    }
  };

  if (error) return <ErrorBanner message={`Git error: ${String(error)}`} />;
  if (!data?.isRepo) return null;

  const status = data.status;
  const branch = data.branch;
  const stagedPaths = status?.files.filter((f) => isStaged(f.index)).map((f) => f.path) ?? [];
  const unstagedPaths = status?.files.filter((f) => !isStaged(f.index)).map((f) => f.path) ?? [];
  const workingChangesCount = status?.files.length ?? 0;
  const initialDraft = uiState?.commitMessageDraftByProject?.[projectId] ?? "";
  const busy = view.busy;
  const busyKind = busy.has("generate") ? "generate" : busy.has("commit") ? "commit" : "idle";
  const showWorkingTree = sel.kind === "working-tree";

  const detailPaneContent = showWorkingTree ? (
    wtPath && wtDiff ? (
      <HunkDiffViewer
        path={wtPath}
        staged={wtDiff.staged}
        unstaged={wtDiff.unstaged}
        loading={wtDiffLoading}
        busy={busy.has("hunk")}
        onStageHunkPatch={async (patch) => {
          await wrap("hunk", async () => {
            await stageHunk(projectId, patch);
            await invalidate({ git: true, diff: wtPath });
          });
        }}
        onUnstageHunkPatch={async (patch) => {
          await wrap("hunk", async () => {
            await unstageHunk(projectId, patch);
            await invalidate({ git: true, diff: wtPath });
          });
        }}
        onClose={() => {
          if (isMobile) closeMobileDetail();
          else
            dispatch({
              type: "select",
              selection: { kind: "working-tree", path: null },
            });
        }}
      />
    ) : (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
        Select a working-tree file to view its diff.
      </div>
    )
  ) : (
    <>
      {commitLoading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
          Loading commit…
        </div>
      )}
      {commit && <CommitDetailsHeader commit={commit} />}
      {commit && commitPath && (
        <PlainDiffViewer
          path={commitPath}
          diff={commitDiff?.diff ?? ""}
          loading={commitDiffLoading}
        />
      )}
      {commit && !commitPath && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
          Select a file in the commit to view its diff.
        </div>
      )}
    </>
  );

  return (
    <GitActionsProvider value={actions}>
      <div className="grid h-full min-h-0 grid-cols-1 gap-2 md:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-3">
        {/* Left — fixed sidebar on desktop only; mobile uses a Sheet below */}
        <aside className="hidden min-h-0 overflow-y-auto md:block">
          <Sidebar projectId={projectId} />
        </aside>

        {/* Center */}
        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <TopBar
            branch={branch}
            ahead={status?.ahead ?? 0}
            behind={status?.behind ?? 0}
            tracking={status?.tracking ?? null}
            busy={Array.from(busy).some((t) => t.startsWith("remote:"))}
            progress={view.progress}
            onFetch={() => runRemoteOp({ action: "fetch" })}
            onPull={() => runRemoteOp({ action: "pull" })}
            onPush={() =>
              runRemoteOp({
                action: "push",
                // First push of a fresh branch needs --set-upstream; otherwise harmless.
                setUpstream: !status?.tracking,
              })
            }
            onForcePush={() => {
              const remote = status?.tracking?.split("/")[0] ?? "origin";
              setDialog({
                id: "force-push",
                branch: branch ?? "",
                remote,
              });
            }}
            onCancel={cancelRemoteOp}
            onOpenSidebar={() => setMobileSidebarExpanded((v) => !v)}
          />
          {mobileSidebarExpanded && (
            <div className="md:hidden">
              <Sidebar projectId={projectId} />
            </div>
          )}
          {actionError && <ErrorBanner message={actionError} />}

          {showWorkingTree && status && status.files.length > 0 && (
            <>
              <WorkingTreeList
                files={status.files}
                selectedPath={wtPath}
                stageBusy={busy.has("stage")}
                onToggleStage={(p, currentlyStaged) => void runStage([p], !currentlyStaged)}
                onSelectDiff={(p) =>
                  dispatch({
                    type: "select",
                    selection: { kind: "working-tree", path: wtPath === p ? null : p },
                  })
                }
                onStageAll={() => void runStage(unstagedPaths, true)}
                onUnstageAll={() => void runStage(stagedPaths, false)}
              />
              <CommitCard
                initialMessage={initialDraft}
                projectKey={projectId}
                stagedCount={stagedPaths.length}
                busy={busyKind}
                onGenerate={onGenerate}
                onCommit={onCommit}
                onPersistDraft={onPersistDraft}
              />
            </>
          )}

          <div>
            <CommitGraph
              projectId={projectId}
              selectedHash={commitHash}
              onSelect={(h) =>
                dispatch({
                  type: "select",
                  selection:
                    h === null
                      ? { kind: "working-tree", path: null }
                      : { kind: "commit", hash: h, path: null },
                })
              }
              hasWorkingChanges={workingChangesCount > 0}
              workingChangesCount={workingChangesCount}
            />
          </div>

          {sel.kind === "commit" && commit && (
            <div className="hidden md:block">
              <CommitFileList
                files={commit.files}
                selectedPath={commitPath}
                onSelect={(p) =>
                  dispatch({
                    type: "select",
                    selection: { kind: "commit", hash: sel.hash, path: p },
                  })
                }
              />
            </div>
          )}
        </section>

        {/* Right — fixed pane on desktop only; mobile uses a bottom Sheet below */}
        <section className="hidden min-h-0 flex-col gap-3 overflow-y-auto md:flex">
          {detailPaneContent}
        </section>
      </div>

      {/* Mobile detail (diff / commit) drawer */}
      <Sheet
        open={mobileDetailOpen}
        onOpenChange={(o) => (o ? setMobileDetailOpen(true) : closeMobileDetail())}
        side="bottom"
        ariaLabel="Diff details"
        className="!max-h-[92vh] !h-[92vh]"
      >
        <div className="flex h-full flex-col">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
            <h2 className="truncate text-sm font-medium text-zinc-100">
              {sel.kind === "commit" ? "Commit" : "Diff"}
            </h2>
            <button
              type="button"
              onClick={closeMobileDetail}
              aria-label="Close"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {sel.kind === "commit" && commit && (
              <CommitFileList
                files={commit.files}
                selectedPath={commitPath}
                onSelect={(p) =>
                  dispatch({
                    type: "select",
                    selection: { kind: "commit", hash: sel.hash, path: p },
                  })
                }
              />
            )}
            {detailPaneContent}
          </div>
        </div>
      </Sheet>

      {/* Dialogs */}
      {dialog?.id === "create-branch" && (
        <CreateBranchDialog
          open
          onClose={() => setDialog(null)}
          startPoint={dialog.startPoint}
          startPointLabel={dialog.startPointLabel}
          busy={busy.has("create-branch")}
          onSubmit={async (name, checkout) => {
            await wrap("create-branch", async () => {
              await createBranch(projectId, name, { startPoint: dialog.startPoint, checkout });
              await invalidate({ git: true, branches: true, graph: true });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "delete-branch" && (
        <DeleteBranchDialog
          open
          onClose={() => setDialog(null)}
          branchName={dialog.name}
          remote={dialog.remote}
          busy={busy.has("delete-branch")}
          onSubmit={async (force) => {
            await wrap("delete-branch", async () => {
              await deleteBranch(projectId, dialog.name, { force, remote: dialog.remote });
              await invalidate({ branches: true, graph: true });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "rename-branch" && (
        <RenameBranchDialog
          open
          onClose={() => setDialog(null)}
          from={dialog.from}
          busy={busy.has("rename-branch")}
          onSubmit={async (to) => {
            await wrap("rename-branch", async () => {
              await renameBranch(projectId, dialog.from, to);
              await invalidate({ branches: true, git: true });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "stash-save" && (
        <StashSaveDialog
          open
          onClose={() => setDialog(null)}
          busy={busy.has("stash-save")}
          onSubmit={async (message, includeUntracked) => {
            await wrap("stash-save", async () => {
              await stashSave(projectId, { message, includeUntracked });
              await invalidate({ git: true, stash: true, graph: includeUntracked });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "reset" && (
        <ResetDialog
          open
          onClose={() => setDialog(null)}
          target={dialog.target}
          targetSubject={dialog.targetSubject}
          busy={busy.has("reset")}
          onSubmit={async (mode) => {
            await wrap("reset", async () => {
              await runReset(projectId, mode, dialog.target);
              await invalidate({ git: true, branches: true, graph: true, diff: wtPath });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "merge" && (
        <MergeDialog
          open
          onClose={() => setDialog(null)}
          branch={dialog.branch}
          currentBranch={branch}
          busy={busy.has("merge")}
          onSubmit={async (opts) => {
            await wrap("merge", async () => {
              await runMerge(projectId, dialog.branch, opts);
              await invalidate({ git: true, branches: true, graph: true });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "checkout-dirty" && (
        <CheckoutDirtyDialog
          open
          onClose={() => setDialog(null)}
          target={dialog.target}
          dirty={dialog.dirty}
          busy={busy.has("checkout-dirty")}
          onStashAndCheckout={async () => {
            await wrap("checkout-dirty", async () => {
              await stashSave(projectId, {
                message: `Auto-stash before checkout ${dialog.target}`,
                includeUntracked: true,
              });
              await checkoutBranch(projectId, dialog.target, false);
              await invalidate({ git: true, branches: true, stash: true, graph: true });
              setDialog(null);
            });
          }}
          onDiscardAndCheckout={async () => {
            await wrap("checkout-dirty", async () => {
              await checkoutBranch(projectId, dialog.target, true);
              await invalidate({ git: true, branches: true, graph: true });
              setDialog(null);
            });
          }}
        />
      )}
      {dialog?.id === "force-push" && (
        <ForcePushDialog
          open
          onClose={() => setDialog(null)}
          branch={dialog.branch}
          remote={dialog.remote}
          busy={Array.from(busy).some((t) => t.startsWith("remote:"))}
          onConfirm={async () => {
            setDialog(null);
            runRemoteOp({
              action: "push",
              force: true,
              setUpstream: !status?.tracking,
            });
          }}
        />
      )}
    </GitActionsProvider>
  );
}
