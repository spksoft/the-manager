"use client";

import type { CommitDetails, GraphNode } from "@the-manager/git";
import { createContext, useContext } from "react";

export type DialogState =
  | { id: "create-branch"; startPoint?: string; startPointLabel?: string }
  | { id: "delete-branch"; name: string; remote?: string }
  | { id: "rename-branch"; from: string }
  | { id: "stash-save" }
  | {
      id: "reset";
      target: string;
      targetSubject?: string;
    }
  | { id: "merge"; branch: string }
  | { id: "force-push"; branch: string; remote: string }
  | {
      id: "checkout-dirty";
      target: string;
      dirty: { path: string; index: string; working_dir: string }[];
    };

export interface GitActions {
  // Branch
  checkout: (name: string) => Promise<void>;
  openCreateBranch: (startPoint?: string, startPointLabel?: string) => void;
  openDeleteBranch: (name: string, remote?: string) => void;
  openRenameBranch: (from: string) => void;
  setUpstream: (branch: string, upstream: string) => Promise<void>;
  // Stash
  openStashSave: () => void;
  stashApply: (index: number, pop: boolean) => Promise<void>;
  stashDrop: (index: number) => Promise<void>;
  // Reset / merge
  openReset: (target: string, subject?: string) => void;
  openMerge: (branch: string) => void;
  // Used by commit-graph context menu so it can pass GraphNode for subject
  openResetForNode: (node: GraphNode) => void;
  openCreateBranchFromCommit: (node: GraphNode) => void;
  // Helpers
  currentBranch: string | null;
  commitDetails: CommitDetails | null;
}

const GitActionsCtx = createContext<GitActions | null>(null);

export function GitActionsProvider({
  value,
  children,
}: {
  value: GitActions;
  children: React.ReactNode;
}) {
  return <GitActionsCtx.Provider value={value}>{children}</GitActionsCtx.Provider>;
}

export function useGitActions(): GitActions {
  const v = useContext(GitActionsCtx);
  if (!v) throw new Error("useGitActions must be used inside <GitActionsProvider>");
  return v;
}
