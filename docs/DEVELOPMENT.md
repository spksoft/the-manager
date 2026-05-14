# Development

Engineering reference for working on **The Manager**. If you're just trying to use the app, the [README](../README.md) has what you need.

For the deep architecture rationale — layering, the CLI driver abstraction, the "one app for all apps" model — see [`CLAUDE.md`](../CLAUDE.md). This file covers the day-to-day mechanics.

## Stack

- **Next.js (App Router)** — UI + Route Handlers, served as both the web app and the Electron renderer.
- **Electron** — desktop shell that loads the same Next.js app and exposes filesystem/process capability via preload IPC.
- **node-pty + xterm.js** — long-lived interactive `claude` sessions streamed to the browser.
- **Turborepo + pnpm workspaces** — monorepo orchestration.
- **Biome** — formatting and linting.
- **Zod** — schema validation in the persistence layer.
- **simple-git** — read-mostly git surface.
- **CodeMirror 6** — in-app file editor.

## Prerequisites

- Node `>= 22` (the repo pins via `.nvmrc`)
- pnpm `10`
- The `claude` CLI on `PATH` (and `codex` / `gemini` if you want to exercise those drivers)
- macOS for `pnpm dmg` (Electron builder targets)

## Workspace layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js App Router — UI + Route Handlers (the "server" surface) |
| `apps/desktop` | Electron shell that loads `apps/web` |
| `packages/core` | Domain layer (pure logic — Project, Agent, Manager, Task) |
| `packages/drivers` | CLI driver abstraction + pty-backed `ClaudeDriver` / `CodexDriver` / `GeminiDriver` |
| `packages/persistence` | JSON-file storage (`JsonStore`, repos) |
| `packages/git` | `simple-git` wrapper for the mini git display |
| `packages/ui` | Shared component primitives |
| `packages/editor` | CodeMirror 6 wrapper |
| `packages/shared` | Types, errors, constants |
| `scripts/` | Release, smoke, and pre-commit hook scripts |

## Commands

All commands run from the repo root. Each maps to a Turbo pipeline that fans out to the right workspaces.

```bash
pnpm install            # install all workspaces
pnpm dev                # web + desktop in parallel
pnpm dev:web            # Next.js only (http://localhost:3000)
pnpm dev:desktop        # Electron only (loads localhost:3000 in dev)
pnpm build              # build all apps + packages
pnpm typecheck          # tsc --noEmit across every workspace
pnpm lint               # biome check
pnpm format             # biome format --write
pnpm dmg                # build the macOS DMG via electron-builder
```

## Verifying a change

There are no unit tests yet. The standard verification gate is:

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm smoke:persistence   # JSON store atomic writes survive a restart
pnpm smoke               # boots `next start` on a free port and exercises every route
```

CI runs the same set on every push and pull request — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Conventions

### Layered design

When adding a feature, put the logic in the lowest layer that can express it and expose it upward through narrow interfaces:

1. **Platform** — Electron main process, Node runtime concerns.
2. **Adapter** — CLI drivers, filesystem, git, persistence.
3. **Domain** — Project, Agent, Manager, Task models; pure logic.
4. **Application** — server actions, route handlers, Electron main IPC handlers (orchestration, permissions, validation).
5. **UI** — Next.js pages / React components (rendering only, no process or filesystem side effects).

### Single codebase, multiple surfaces

- The Next.js app must run unchanged in a browser tab and inside Electron.
- Anything that needs Node / filesystem / process APIs goes through server actions (web) or Electron IPC (desktop). React components call the same higher-level functions in both cases — a thin transport adapter decides whether the call goes over HTTP or IPC.
- **Never `import 'electron'` from a client component.**

### CLI abstraction

All agent CLI interaction goes through driver interfaces in `packages/drivers`. Never call `claude` (or any other CLI) directly from UI or business-logic code.

The current path is `PtyAgentDriver` — a long-lived pty session. `ClaudeDriver` spawns `claude` (no `-p`) under a pty so the full interactive REPL renders in the UI. New CLI agents (Codex, Gemini, …) plug in by subclassing `PtyAgentDriver` with their binary name; the rest of the stack is identical.

The web/Electron consumer is `apps/web/lib/sessions.ts`, which owns a `globalThis`-backed registry of live sessions keyed by `projectId`. Three route handlers expose it:

- `GET  /api/projects/[id]/terminal/stream` — SSE of raw bytes; replays the recent recording on attach.
- `POST /api/projects/[id]/terminal` — input or resize.
- `DELETE /api/projects/[id]/conversation` — kill the pty so the next attach spawns a fresh `claude`.

### Internal imports

Workspace packages export their TypeScript source directly (`main: "./src/index.ts"`) and consumers re-bundle via Next's `transpilePackages` or `tsx` in dev.

- **Internal imports inside a single package must be extensionless** (`./foo`, not `./foo.js`). Turbopack does not rewrite `.js` back to `.ts` in transpiled workspace packages — this surfaces as `Module not found: Can't resolve './foo.js'` at first request.
- **Cross-package imports use the package name** (`@the-manager/shared`), never relative paths.

### Zod schemas and `.default()`

`packages/persistence/src/schemas.ts` deliberately does **not** use `z.default(...)` on object fields, even though it's tempting. With `.default()`, the schema's input and output types diverge (`tags?: string[]` vs `tags: string[]`), which breaks `JsonStore<T extends z.ZodType<T>>`'s single generic. Provide complete defaults at the repo's `defaultValue` factory instead.

## Release process

Releases are tag-driven. Tagging `vX.Y.Z` triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds the macOS DMG and publishes a GitHub Release with auto-generated notes.

```bash
pnpm release            # bumps versions across the workspace, commits, tags
git push --follow-tags  # push the tag so the release workflow runs
```

The workflow fails fast if the tag doesn't match `apps/desktop/package.json#version` — keep the bump and tag in sync (the script already does this).

## Filing issues / PRs

- For bugs, include OS, Node version, and the relevant log output (`apps/web` runs in your terminal in dev; the Electron main process logs there too).
- For features, sketch the layer the change belongs in (UI / application / domain / adapter / platform) before implementing.
- Run the verification gate above before opening a PR.
