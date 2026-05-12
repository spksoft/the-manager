"use client";

import { cn } from "@the-manager/ui";
import { useState } from "react";
import { useProject } from "../lib/hooks";
import { ChatView } from "./ChatView";
import { ErrorBanner } from "./ErrorBanner";
import { FilesTab } from "./FilesTab";
import { GitTab } from "./GitTab";

type Tab = "agent" | "files" | "git";
const TABS: { id: Tab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "files", label: "Files" },
  { id: "git", label: "Git" },
];

interface ProjectWorkspaceProps {
  projectId: string;
}

export function ProjectWorkspace({ projectId }: ProjectWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>("agent");
  const { data: project, error } = useProject(projectId);

  if (error) {
    return <ErrorBanner message={`Failed to load project: ${String(error)}`} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Project workspace tabs"
        className="flex gap-1 border-b border-zinc-800 px-1 pt-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "rounded-t-md px-4 py-2 text-sm font-medium transition-colors",
              activeTab === t.id
                ? "border-b-2 border-emerald-400 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {activeTab === "agent" && (
          <ChatView
            projectId={projectId}
            emptyHint={
              project
                ? `Send a prompt to the Claude agent running in ${project.path}.`
                : "Loading project…"
            }
          />
        )}
        {activeTab === "files" && <FilesTab projectId={projectId} />}
        {activeTab === "git" && <GitTab projectId={projectId} />}
      </div>
    </div>
  );
}
