"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { useEffect, useMemo, useState } from "react";
import { AssetBrowser } from "../components/AssetBrowser";
import { CommandPalette } from "../components/CommandPalette";
import { EditProjectDialog } from "../components/EditProjectDialog";
import { ManagerSurface } from "../components/ManagerSurface";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { NotificationsBell } from "../components/NotificationsBell";
import { ProjectWorkspace } from "../components/ProjectWorkspace";
import { SettingsPanel } from "../components/SettingsPanel";
import { type ActiveView, Sidebar } from "../components/Sidebar";
import { useProjects } from "../lib/hooks";

export default function HomePage() {
  const [activeView, setActiveView] = useState<ActiveView>({ type: "manager" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        activeView={activeView}
        onSelectManager={() => setActiveView({ type: "manager" })}
        onSelectProject={(id) => setActiveView({ type: "project", id })}
        onSelectAssets={() => setActiveView({ type: "assets" })}
        onAddProject={() => setNewProjectOpen(true)}
        onEditProject={(project) => setEditingProject(project)}
        onRemoveProject={async (id, name) => {
          if (
            !window.confirm(
              `Remove project "${name}" from The Manager?\n\nThis only forgets the registration; nothing on disk is deleted.`,
            )
          ) {
            return;
          }
          await fetch(`/api/projects/${id}`, { method: "DELETE" });
          void mutateProjects(projects.filter((p) => p.id !== id));
          if (activeView.type === "project" && activeView.id === id) {
            setActiveView({ type: "manager" });
          }
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-8 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{headerTitle}</h1>
            {headerSub && <p className="mt-0.5 text-sm text-zinc-500">{headerSub}</p>}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </span>
            <NotificationsBell projects={projects} onJump={(target) => setActiveView(target)} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-8 py-6">
          {activeView.type === "manager" && <ManagerSurface />}
          {activeView.type === "assets" && <AssetBrowser />}
          {activeView.type === "project" && <ProjectWorkspace projectId={activeView.id} />}
        </div>
      </main>

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
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
