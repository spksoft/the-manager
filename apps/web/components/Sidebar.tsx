"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { SidebarItem } from "./SidebarItem";

export type ActiveView = { type: "manager" } | { type: "project"; id: string } | { type: "assets" };

interface SidebarProps {
  projects: ProjectRow[];
  activeView: ActiveView;
  onSelectManager: () => void;
  onSelectProject: (id: string) => void;
  onSelectAssets: () => void;
  onAddProject: () => void;
  onRemoveProject: (id: string, name: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  projects,
  activeView,
  onSelectManager,
  onSelectProject,
  onSelectAssets,
  onAddProject,
  onRemoveProject,
  onOpenSettings,
}: SidebarProps) {
  const managerActive = activeView.type === "manager";
  const assetsActive = activeView.type === "assets";

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/40">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-800 px-4">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-sm font-semibold tracking-tight text-zinc-100">The Manager</span>
      </div>

      <div className="flex flex-col gap-1 p-2">
        <SidebarItem
          label="Manager"
          icon={<span aria-hidden>◆</span>}
          active={managerActive}
          onClick={onSelectManager}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Projects
          </span>
          <button
            type="button"
            aria-label="Add project"
            onClick={onAddProject}
            className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
          >
            +
          </button>
        </div>
        <nav
          aria-label="Projects list"
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
        >
          {projects.length === 0 && (
            <button
              type="button"
              onClick={onAddProject}
              className="mx-1 mt-2 rounded-md border border-dashed border-zinc-800 px-3 py-3 text-left text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
            >
              No projects yet — click to register one.
            </button>
          )}
          {projects.map((p) => (
            <SidebarItem
              key={p.id}
              label={p.name}
              active={activeView.type === "project" && activeView.id === p.id}
              onClick={() => onSelectProject(p.id)}
              hoverAction={
                <button
                  type="button"
                  aria-label={`Remove project ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveProject(p.id, p.name);
                  }}
                  className="rounded p-0.5 text-zinc-600 hover:text-red-300"
                  title="Remove project"
                >
                  ✕
                </button>
              }
            />
          ))}
        </nav>

        <div className="px-2 pb-2">
          <SidebarItem
            label="Assets"
            icon={<span aria-hidden>▣</span>}
            active={assetsActive}
            onClick={onSelectAssets}
          />
        </div>
      </div>

      <div className="border-t border-zinc-800 p-2">
        <SidebarItem label="Settings" icon={<span aria-hidden>⚙</span>} onClick={onOpenSettings} />
      </div>
    </aside>
  );
}
