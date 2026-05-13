"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { type SessionStatus, useSessionStatuses } from "../lib/hooks";
import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import { SidebarItem } from "./SidebarItem";

/**
 * Liveness windows (ms) for the colored dot next to each project.
 * - active:  data within ~10s → bright green, pulses subtly
 * - idle:    session is alive but quiet → dim gray
 * - exited:  registry entry is gone or marked exited → red
 * - none:    no session ever started for this project → invisible
 */
const ACTIVE_WINDOW_MS = 10_000;

function statusColor(status: SessionStatus | undefined): {
  className: string;
  title: string;
} | null {
  if (!status) return null;
  if (!status.alive) {
    return { className: "bg-red-500", title: "Session exited" };
  }
  const last = status.lastActivityAt ? Date.parse(status.lastActivityAt) : 0;
  const fresh = Date.now() - last < ACTIVE_WINDOW_MS;
  return fresh
    ? {
        className: "bg-emerald-400 animate-pulse",
        title: "Active",
      }
    : { className: "bg-zinc-600", title: "Idle" };
}

export type ActiveView = { type: "manager" } | { type: "project"; id: string } | { type: "assets" };

interface SidebarProps {
  projects: ProjectRow[];
  activeView: ActiveView;
  onSelectManager: () => void;
  onSelectProject: (id: string) => void;
  onSelectAssets: () => void;
  onAddProject: () => void;
  onEditProject: (project: ProjectRow) => void;
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
  onEditProject,
  onRemoveProject,
  onOpenSettings,
}: SidebarProps) {
  const managerActive = activeView.type === "manager";
  const assetsActive = activeView.type === "assets";
  const { data: statusData } = useSessionStatuses();
  const statuses = statusData?.statuses ?? {};
  const managerStatus = statuses[MANAGER_PROJECT_ID];
  const managerDot = statusColor(managerStatus);

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/40">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-800 px-4">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-sm font-semibold tracking-tight text-zinc-100">The Manager</span>
      </div>

      <div className="flex flex-col gap-1 p-2">
        <SidebarItem
          label="Manager"
          icon={
            <span aria-hidden className="relative flex h-3 w-3 items-center justify-center">
              <span>◆</span>
              {managerDot && (
                <span
                  role="status"
                  aria-label={`Manager status: ${managerDot.title}`}
                  title={managerDot.title}
                  className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${managerDot.className}`}
                />
              )}
            </span>
          }
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
          {projects.map((p) => {
            const dot = statusColor(statuses[p.id]);
            return (
              <SidebarItem
                key={p.id}
                label={p.name}
                icon={
                  dot ? (
                    <span
                      role="status"
                      aria-label={`${p.name} status: ${dot.title}`}
                      title={dot.title}
                      className={`inline-block h-2 w-2 rounded-full ${dot.className}`}
                    />
                  ) : (
                    <span
                      role="status"
                      aria-label={`${p.name} has no live session`}
                      title="No session"
                      className="inline-block h-2 w-2 rounded-full border border-zinc-700"
                    />
                  )
                }
                active={activeView.type === "project" && activeView.id === p.id}
                onClick={() => onSelectProject(p.id)}
                hoverAction={
                  <span className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`Edit project ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditProject(p);
                      }}
                      className="rounded p-0.5 text-zinc-600 hover:text-zinc-200"
                      title="Edit project"
                    >
                      ✎
                    </button>
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
                  </span>
                }
              />
            );
          })}
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
