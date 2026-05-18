"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { Sheet } from "@the-manager/ui";
import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { AssetBrowser } from "../components/AssetBrowser";
import { BottomTerminalDrawer } from "../components/BottomTerminalDrawer";
import { CommandPalette } from "../components/CommandPalette";
import { EditProjectDialog } from "../components/EditProjectDialog";
import { InboxButton } from "../components/InboxButton";
import { ManagerRequestBroker } from "../components/ManagerRequestBroker";
import { ManagerSurface } from "../components/ManagerSurface";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { NotificationsBell } from "../components/NotificationsBell";
import { ProjectWorkspace } from "../components/ProjectWorkspace";
import { SettingsPanel } from "../components/SettingsPanel";
import { type ActiveView, Sidebar } from "../components/Sidebar";
import { StatusStrip } from "../components/StatusStrip";
import { useProjects, useUiState } from "../lib/hooks";
import { transport } from "../lib/transport";

export default function HomePage() {
  const { data: uiState, patchUiState } = useUiState();
  const activeView: ActiveView = uiState?.activeView ?? { type: "manager" };
  const setActiveView = (view: ActiveView) => void patchUiState({ activeView: view });
  const { mutate: swrMutate } = useSWRConfig();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: projects = [], mutate: mutateProjects } = useProjects();

  // Command palette toggle: ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Electron tray's "Preferences…" item asks the renderer to open Settings.
  useEffect(() => transport.onOpenPreferences(() => setSettingsOpen(true)), []);

  // If the viewport grows past the md breakpoint, the persistent sidebar takes
  // over — close the mobile sheet so backdrop/scroll-lock don't linger.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handle = () => mq.matches && setSidebarOpen(false);
    handle();
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);

  const headerTitle = useMemo(() => {
    if (activeView.type === "manager") return "Manager";
    if (activeView.type === "assets") return "Assets";
    if (activeView.type === "project") {
      return projects.find((p) => p.id === activeView.id)?.name ?? "Project";
    }
    return "Dashboard";
  }, [activeView, projects]);

  const headerSub = useMemo(() => {
    if (activeView.type === "manager")
      return "Issue commands to orchestrate agents across projects.";
    if (activeView.type === "assets") return "Shared files and blobs across projects.";
    if (activeView.type === "project") {
      const p = projects.find((pr) => pr.id === activeView.id);
      return p?.path ?? "";
    }
    return "";
  }, [activeView, projects]);

  const sidebarProps = {
    projects,
    activeView,
    onSelectManager: () => setActiveView({ type: "manager" }),
    onSelectProject: (id: string) => setActiveView({ type: "project", id }),
    onSelectAssets: () => setActiveView({ type: "assets" }),
    onAddProject: () => setNewProjectOpen(true),
    onEditProject: (project: ProjectRow) => setEditingProject(project),
    onRemoveProject: async (id: string, name: string) => {
      if (
        !window.confirm(
          `Remove project "${name}" from The Manager?\n\nThis only forgets the registration; nothing on disk is deleted.`,
        )
      ) {
        return;
      }
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      void mutateProjects(projects.filter((p) => p.id !== id));
      // Server's DELETE handler also clears any ui-state pointing at this
      // project; revalidate so the activeView reflects that.
      void swrMutate("/api/ui-state");
    },
    onOpenSettings: () => setSettingsOpen(true),
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar {...sidebarProps} />
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen} side="left" ariaLabel="Navigation">
          <Sidebar {...sidebarProps} variant="drawer" onNavigate={() => setSidebarOpen(false)} />
        </Sheet>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-3 md:px-8 md:py-5">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
                className="-ml-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800/60 md:hidden"
              >
                <span aria-hidden className="text-lg leading-none">
                  ☰
                </span>
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-zinc-50 md:text-xl">
                  {headerTitle}
                </h1>
                {headerSub && (
                  <p className="mt-0.5 hidden truncate text-sm text-zinc-500 md:block">
                    {headerSub}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3 text-xs text-zinc-500">
              <StatusStrip projects={projects} onJump={(target) => setActiveView(target)} />
              <InboxButton />
              <span className="hidden sm:inline">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
              <NotificationsBell projects={projects} onJump={(target) => setActiveView(target)} />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 md:px-8 md:py-6">
            {activeView.type === "manager" && <ManagerSurface />}
            {activeView.type === "assets" && <AssetBrowser />}
            {activeView.type === "project" && <ProjectWorkspace projectId={activeView.id} />}
          </div>
        </main>
      </div>

      <BottomTerminalDrawer />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          void mutateProjects([...(projects ?? []), project]);
          setActiveView({ type: "project", id: project.id });
          setNewProjectOpen(false);
        }}
      />
      <EditProjectDialog
        open={editingProject !== null}
        project={editingProject}
        onClose={() => setEditingProject(null)}
        onUpdated={(updated) => {
          void mutateProjects((projects ?? []).map((p) => (p.id === updated.id ? updated : p)));
          setEditingProject(null);
        }}
      />
      <ManagerRequestBroker
        onCreated={(project) => {
          void mutateProjects([...(projects ?? []), project]);
          setActiveView({ type: "project", id: project.id });
        }}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(view) => setActiveView(view)}
      />
    </div>
  );
}
