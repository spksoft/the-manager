import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ProjectRow, paths } from "@the-manager/persistence";
import { repos } from "./runtime";

/**
 * Manager memory layout, all under the Manager's cwd:
 *
 *   projects/_index.md    — auto-maintained roll-up of every registered project
 *   projects/<id>.md      — per-project notes the Manager writes itself
 *   journal/_index.md     — auto-maintained last-30-days header
 *   journal/YYYY-MM-DD.md — daily journal, one heading per finished task
 *
 * The two `_index.md` files have an app-managed section between
 *   <!-- managed:<kind> start --> ... <!-- managed:<kind> end -->
 * markers. Free-form text outside the markers is the Manager's space and is
 * never touched by `refreshIndices`.
 */

const PROJECT_MARKERS = {
  start: "<!-- managed:projects start -->",
  end: "<!-- managed:projects end -->",
} as const;

const JOURNAL_MARKERS = {
  start: "<!-- managed:journal start -->",
  end: "<!-- managed:journal end -->",
} as const;

const JOURNAL_INDEX_DAYS = 30;

function projectsDir(cwd: string): string {
  return join(cwd, "projects");
}

function journalDir(cwd: string): string {
  return join(cwd, "journal");
}

function projectsIndexPath(cwd: string): string {
  return join(projectsDir(cwd), "_index.md");
}

function journalIndexPath(cwd: string): string {
  return join(journalDir(cwd), "_index.md");
}

function projectNotePath(cwd: string, projectId: string): string {
  return join(projectsDir(cwd), `${projectId}.md`);
}

function journalDayPath(cwd: string, isoDate: string): string {
  return join(journalDir(cwd), `${isoDate}.md`);
}

/**
 * Rewrites the section between `start` and `end` markers in `body`, returning
 * the new full text. If the markers are missing the file is treated as
 * uninitialised and the whole body is replaced with a fresh template.
 */
function replaceManagedSection(
  body: string,
  markers: { start: string; end: string },
  newContent: string,
): string {
  const startIdx = body.indexOf(markers.start);
  const endIdx = body.indexOf(markers.end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return `${markers.start}\n${newContent}\n${markers.end}\n`;
  }
  const before = body.slice(0, startIdx + markers.start.length);
  const after = body.slice(endIdx);
  return `${before}\n${newContent}\n${after}`;
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

export interface RefreshIndicesInput {
  projects: ProjectRow[];
}

/**
 * Make sure the memory tree exists for `cwd`. Idempotent.
 */
export async function ensure(cwd: string): Promise<void> {
  await mkdir(projectsDir(cwd), { recursive: true });
  await mkdir(journalDir(cwd), { recursive: true });
}

/**
 * Render the projects/_index.md managed section and rewrite both index files.
 */
export async function refreshIndices(cwd: string, input: RefreshIndicesInput): Promise<void> {
  await ensure(cwd);

  const projectLines = input.projects
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const desc = p.description ? ` — ${p.description.replace(/\s+/g, " ").trim()}` : "";
      const tag = p.ephemeral ? " _(ephemeral)_" : "";
      return `- **${p.name}** \`${p.id}\` — \`${p.path}\` (${p.defaultDriver})${tag}${desc}`;
    });
  const projectsBody =
    projectLines.length === 0 ? "_No projects registered yet._" : projectLines.join("\n");
  const existingProjects = await readOr(
    projectsIndexPath(cwd),
    `# Projects\n\nApp-managed roll-up of every project the user has registered. The list between the markers is rewritten automatically — leave free-form notes outside the markers.\n\n${PROJECT_MARKERS.start}\n\n${PROJECT_MARKERS.end}\n`,
  );
  await writeFile(
    projectsIndexPath(cwd),
    replaceManagedSection(existingProjects, PROJECT_MARKERS, projectsBody),
    "utf8",
  );

  // Journal index: last 30 days of dated files present on disk.
  let journalEntries: { date: string; count: number }[] = [];
  try {
    const entries = await readdir(journalDir(cwd));
    const dated = entries
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .map((name) => name.replace(/\.md$/, ""))
      .sort()
      .reverse()
      .slice(0, JOURNAL_INDEX_DAYS);
    journalEntries = await Promise.all(
      dated.map(async (date) => {
        const content = await readOr(journalDayPath(cwd, date), "");
        const count = (content.match(/^## /gm) ?? []).length;
        return { date, count };
      }),
    );
  } catch {
    /* no journal dir yet — leave empty */
  }
  const journalBody =
    journalEntries.length === 0
      ? "_No journal entries yet._"
      : journalEntries
          .map((e) => `- ${e.date} (${e.count} task${e.count === 1 ? "" : "s"})`)
          .join("\n");
  const existingJournal = await readOr(
    journalIndexPath(cwd),
    `# Journal\n\nApp-managed index of recent activity. Daily files (\`YYYY-MM-DD.md\`) live next to this one and are appended to when tasks finish.\n\n${JOURNAL_MARKERS.start}\n\n${JOURNAL_MARKERS.end}\n`,
  );
  await writeFile(
    journalIndexPath(cwd),
    replaceManagedSection(existingJournal, JOURNAL_MARKERS, journalBody),
    "utf8",
  );
}

export interface JournalEntry {
  taskId: string;
  title: string;
  bodyMd: string;
  finishedAt: string;
}

/**
 * Append a task entry to today's journal file. Creates the file if needed.
 */
export async function appendJournal(cwd: string, entry: JournalEntry): Promise<void> {
  await ensure(cwd);
  const day = entry.finishedAt.slice(0, 10);
  const file = journalDayPath(cwd, day);
  const header = await readOr(file, `# ${day}\n\n`);
  const section = `## ${entry.title}\n\n_Task ${entry.taskId} — finished ${entry.finishedAt}_\n\n${entry.bodyMd.trim()}\n\n`;
  await writeFile(file, `${header.trimEnd()}\n\n${section}`, "utf8");
}

/**
 * Create a per-project note file if it doesn't exist. Manager owns the body
 * after that — we never overwrite.
 */
export async function ensureProjectNote(cwd: string, project: ProjectRow): Promise<void> {
  await ensure(cwd);
  const file = projectNotePath(cwd, project.id);
  try {
    await readFile(file, "utf8");
    return;
  } catch {
    /* create */
  }
  const body = `# ${project.name}

_${project.path}_

Default driver: \`${project.defaultDriver}\`${project.description ? `\n\n${project.description}` : ""}

## Notes

Free-form scratch space for what you learn about this project across sessions.
Open questions, gotchas, conventions, last task summaries — anything that
should outlive a single Manager conversation.
`;
  await writeFile(file, body, "utf8");
}

/**
 * Fire-and-forget convenience for route handlers: list projects, refresh the
 * indices, and best-effort seed project notes. Swallows errors so a memory
 * hiccup never breaks the user-facing mutation.
 */
export function refreshManagerMemoryInBackground(): void {
  void (async () => {
    try {
      const cwd = paths.managerCwd();
      const projects = await repos.projects.list();
      await refreshIndices(cwd, { projects });
      await Promise.all(projects.map((p) => ensureProjectNote(cwd, p)));
    } catch (err) {
      console.error("[manager-memory] refresh failed:", err);
    }
  })();
}
