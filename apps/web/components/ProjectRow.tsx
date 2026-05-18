import type { ProjectRow as ProjectRowData } from "@the-manager/persistence";

const DRIVER_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

interface ProjectRowProps {
  project: ProjectRowData;
}

export function ProjectRow({ project }: ProjectRowProps) {
  return (
    <div className="flex items-center gap-4 border-b border-zinc-900 px-5 py-4 transition-colors hover:bg-zinc-900/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-zinc-100">{project.name}</h3>
          <span className="rounded-sm bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {DRIVER_LABEL[project.defaultDriver] ?? project.defaultDriver}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{project.path}</p>
        <p
          className={`mt-1 line-clamp-2 text-xs ${project.description ? "text-zinc-400" : "italic text-zinc-600"}`}
        >
          {project.description ?? "Description generating via claude -p…"}
        </p>
      </div>
      <div className="hidden text-xs text-zinc-500 sm:block">
        {project.lastUsedAt ? shortDate(project.lastUsedAt) : "—"}
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
