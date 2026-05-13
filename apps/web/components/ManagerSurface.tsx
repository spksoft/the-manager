"use client";

import { cn } from "@the-manager/ui";
import { useState } from "react";
import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import { FilesTab } from "./FilesTab";
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
  const [activeTab, setActiveTab] = useState<Tab>("agent");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Manager workspace tabs"
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

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {activeTab === "agent" && <TerminalView projectId={MANAGER_PROJECT_ID} />}
        {activeTab === "files" && <FilesTab projectId={MANAGER_PROJECT_ID} />}
      </div>
    </div>
  );
}
