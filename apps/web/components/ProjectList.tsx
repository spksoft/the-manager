import type { ProjectRow } from "@the-manager/persistence";
import { ProjectRow as ProjectRowComponent } from "./ProjectRow";

interface ProjectListProps {
  projects: ProjectRow[];
}

export function ProjectList({ projects }: ProjectListProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-200">Projects</h2>
        <span className="text-xs text-zinc-500">{projects.length} total</span>
      </header>
      <div className="flex flex-col">
        {projects.length === 0 && (
          <p className="px-5 py-6 text-sm text-zinc-500">
            No projects yet — register one to get started.
          </p>
        )}
        {projects.map((p) => (
          <ProjectRowComponent key={p.id} project={p} />
        ))}
      </div>
    </section>
  );
}
