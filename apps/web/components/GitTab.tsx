"use client";

import { useSWRConfig } from "swr";
import { useGit } from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";
import { GitWorkspace } from "./git/GitWorkspace";
import { InitRepoForm } from "./git/InitRepoForm";

interface GitTabProps {
  projectId: string;
}

/**
 * Project Git tab router. Loads the bundled git state once and decides
 * between the init-repo form (no `.git`) and the full three-pane GitWorkspace.
 */
export function GitTab({ projectId }: GitTabProps) {
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useGit(projectId);

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
    return (
      <InitRepoForm
        projectId={projectId}
        onInitialized={() => void mutate(`/api/projects/${projectId}/git`)}
      />
    );
  }

  return <GitWorkspace projectId={projectId} />;
}
