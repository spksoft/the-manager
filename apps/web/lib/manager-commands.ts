import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Manager "playbooks" — Claude Code custom slash commands seeded into the
 * Manager's cwd at `.claude/commands/*.md`. Claude Code reads that directory
 * on startup and exposes each file as `/<name>`, substituting `$ARGUMENTS`
 * with whatever the user typed after the command.
 *
 * These are system-managed: rewritten on every Manager spawn so updates land
 * in existing workspaces. We only ever write our own named files, so any
 * commands the user drops into the same directory by hand survive untouched.
 *
 * Hard rule: every playbook here uses only tools the Manager already has —
 * the `the-manager` MCP server plus its own scratch cwd. None of them write
 * into a user project directory; project work always goes through
 * `send_to_project` to the project's own agent.
 */

interface ManagerCommand {
  /** File basename without extension; becomes the `/<name>` slash command. */
  name: string;
  content: string;
}

const STATUS = `---
description: Dashboard of every registered project (sessions + git state)
---

Build a compact status dashboard of every registered project. This is
orchestration-meta — answer it yourself, do not delegate.

1. Call \`list_projects\` to enumerate everything.
2. For each project, call \`get_project_status\` (is its claude session alive?)
   and \`get_project_git_status\` (branch, dirty count, ahead/behind).
3. Render a scannable table, one row per project:
   name — tags — branch — dirty? — ahead/behind — session alive? — the
   one-line description.
4. Call out anything notable (dirty trees, unpushed commits, dead sessions)
   in a short line under the table.

Keep it terse. No project file reads beyond what the tools above return.`;

const DISPATCH = `---
description: Delegate a task to the right project agent
argument-hint: <project hint> — <task>
---

Delegate this request to the correct project's agent:

$ARGUMENTS

Steps:
1. **Resolve the target project.** If the text names a project or a tag, use
   \`find_projects({ tags?, namePattern? })\`; otherwise call \`list_projects\`
   and pick the best match. Prefer a project whose session is already alive
   (\`get_project_status\`). If two match equally well, ask ONE short
   clarifying question instead of guessing.
2. **Load context first.** \`memory_read({ projectId })\` for standing notes,
   and \`get_project_git_status\` if the task touches code state.
3. **Refine the task.** Turn the raw request into a complete instruction the
   project agent can act on — don't echo it verbatim. If a slash command on
   the project agent fits the intent, send \`/<command> <args>\` instead of
   prose.
4. **\`send_to_project(id, refinedPrompt)\`.** Remember: on a cold spawn the
   prompt is typed but NOT submitted (returns "spawned") — tell the user it's
   queued in the project's terminal for them to send. On an existing session
   it's submitted (returns "sent").
5. **If it was submitted, wait briefly then \`read_project_terminal(id)\`** and
   surface the agent's reply.
6. **If you learned something durable** about the project, append it with
   \`memory_append({ projectId, text })\`.`;

const ONBOARD = `---
description: Get oriented on a project (read-only) and warm its memory
argument-hint: <project hint>
---

Get oriented on this project WITHOUT changing anything:

$ARGUMENTS

Steps:
1. Resolve the project via \`find_projects\` / \`list_projects\`.
2. Gather read-only context with the introspection tools:
   - \`memory_read({ projectId })\` — what's already known
   - \`get_project_git_status\` + \`get_project_git_log(id, 10)\`
   - \`list_project_files(id, "", 2)\` for the shape of the tree
   - \`read_project_file\` on the README / main manifest if one exists
   - \`search_project\` for any specific symbol the user mentioned
3. Summarise for the user: what the project is, current branch + dirty state,
   recent activity, and any gotchas already recorded in memory.
4. If your orientation surfaced something durable that ISN'T already in
   memory, append a short note via \`memory_append({ projectId, text })\` so
   the next session starts warmer.

Do NOT edit project files or run anything in the project — this is pure
orientation. For actual work, use /dispatch.`;

const REMEMBER = `---
description: Save a durable note to the Manager's long-term memory
argument-hint: [project hint] <note>
---

Save this to long-term memory:

$ARGUMENTS

- If the note clearly concerns ONE project, resolve it with \`find_projects\`
  and append with \`memory_append({ projectId, text, heading? })\`.
- Otherwise it's a cross-project / preference note — append to global memory
  with \`memory_append({ text, heading? })\`.

Use a short \`heading\` when the note starts a new topic. Confirm back to the
user exactly what you saved and to which scope (global vs. which project).`;

const STANDUP = `---
description: Recent activity across all projects (standup report)
---

Produce a standup-style report of recent activity across every project. This
is read-only orchestration-meta — answer it yourself.

1. \`list_projects\`.
2. For each, \`get_project_git_log(id, 5)\` and \`get_project_git_status\`.
3. Group by project: recent commit subjects + whether the tree is dirty or
   ahead of upstream.
4. Flag anything that looks stuck: a dirty tree with no recent commits, or
   commits ahead of the remote that haven't been pushed.

Keep it brief and skimmable — subjects only, not full diffs.`;

const COMMANDS: ManagerCommand[] = [
  { name: "status", content: STATUS },
  { name: "dispatch", content: DISPATCH },
  { name: "onboard", content: ONBOARD },
  { name: "remember", content: REMEMBER },
  { name: "standup", content: STANDUP },
];

/**
 * Write the playbook files into `<cwd>/.claude/commands/`. Idempotent; safe to
 * call on every Manager spawn. Each file ends with a trailing newline so the
 * markdown renders cleanly if the user opens it in the Files tab.
 */
export async function writeManagerCommands(cwd: string): Promise<void> {
  const dir = join(cwd, ".claude", "commands");
  await mkdir(dir, { recursive: true });
  await Promise.all(
    COMMANDS.map((cmd) =>
      writeFile(join(dir, `${cmd.name}.md`), `${cmd.content.trimEnd()}\n`, "utf8"),
    ),
  );
}
