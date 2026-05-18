"use client";

import { cn } from "@the-manager/ui";
import { setManagerTab, useProjects, useUiState } from "../lib/hooks";
import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import { FilesTab } from "./FilesTab";
import { ManagerOnboarding } from "./ManagerOnboarding";
import { TerminalView } from "./TerminalView";

/**
 * The Manager surface mirrors `ProjectWorkspace`'s tab layout, just with a
 * smaller tab set. The Files tab points at the Manager's private cwd
 * (`~/.the-manager/manager/cwd`), which is where the auto-written `CLAUDE.md`
 * and `.mcp.json` live alongside the user-owned `USER_INSTRUCTION.md` and
 * `SOUL.md` — so the user can read/edit those without leaving the app.
 */
type Tab = "agent" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "files", label: "Files" },
];

export function ManagerSurface() {
  const { data, patchUiState } = useUiState();
  const { data: projects = [] } = useProjects();
  const activeTab: Tab = data?.activeTabManager ?? "agent";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Manager workspace tabs"
        className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 px-1 pt-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={activeTab === t.id}
            onClick={() => void setManagerTab(patchUiState, t.id)}
            className={cn(
              "flex-shrink-0 rounded-t-md px-3 py-2 text-sm font-medium transition-colors md:px-4",
              activeTab === t.id
                ? "border-b-2 border-emerald-400 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 md:p-4">
        {activeTab === "agent" && (
          <>
            <ManagerOnboarding projects={projects} />
            <div className="min-h-0 flex-1 overflow-hidden">
              <TerminalView projectId={MANAGER_PROJECT_ID} />
            </div>
          </>
        )}
        {activeTab === "files" && <FilesTab projectId={MANAGER_PROJECT_ID} />}
      </div>
    </div>
  );
}
