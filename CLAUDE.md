# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Manager** is a meta-agent application for managing CLI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) across multiple projects. The initial implementation targets the Claude Code CLI only, but all CLI interaction must be built behind an abstraction layer so additional agents can be plugged in later.

The app is delivered as **three surfaces from one codebase**:
- **Web** (Next.js)
- **Desktop** (Electron wrapping the Next.js app)
- **Server** (Next.js route handlers / server actions)

There is no separate native client — Electron loads the Next.js app and exposes filesystem/process capabilities through preload IPC.

## Core Concepts

- **Project**: A working directory the user has registered with The Manager. Each project can host one or more agents.
- **Agent**: An instance of a CLI tool (initially `claude` command) operating inside a project's working directory.
- **Manager**: A privileged Claude-powered agent that lives at the app level (not inside any single project). It has its own working directory and can:
  - Receive commands from the user
  - Dispatch / orchestrate other agents across projects
  - Perform standalone tasks (Q&A, research) without touching project code
- **Global Storage**: A shared filesystem area outside any single project, used to pass assets/context between projects and to the Manager.

The mental model is "one app for all apps" — a single control plane where the user issues commands to the Manager, and the Manager fans them out to per-project agents.

## Architecture Principles

### CLI Abstraction Layer
All agent CLI interaction goes through driver interfaces in `packages/drivers`:

- **`AgentDriver` / `PtyAgentDriver`** (the primary path) — long-lived pty session. `ClaudeDriver` spawns `claude` (no `-p`) under a pty so the full interactive REPL renders in the UI. The client (xterm.js in the browser or Electron) attaches via SSE for output and POST for keystrokes; the pty is born sized to the client and resizes with it. One process per project (and one for the Manager) — conversation continuity comes from the process staying alive, not from `--session-id` / `--resume`. Per-message cold start is gone.
- New CLI agents (Codex, Gemini, etc.) plug in by subclassing `PtyAgentDriver` with their binary name; the rest of the stack is identical.

Never call `claude` (or any other CLI) directly from UI or business-logic code — always go through the driver layer.

The web/Electron consumer of this is `apps/web/lib/sessions.ts`, which owns a `globalThis`-backed registry of live sessions keyed by `projectId`. Two route handlers expose it: `GET /api/projects/[id]/terminal/stream` (SSE of raw bytes, replays the recent recording on attach) and `POST /api/projects/[id]/terminal` (input or resize). `DELETE /api/projects/[id]/conversation` kills the pty so the next attach spawns a fresh claude.

### Layered Design (target shape)
- **UI layer** (Next.js pages / React components) — rendering only, no process or fs side effects
- **Application layer** (server actions / route handlers / Electron main IPC handlers) — orchestration, permissions, validation
- **Domain layer** — Project, Agent, Manager, Task models; pure logic
- **Adapter layer** — CLI drivers, filesystem, git, persistence
- **Platform layer** — Electron main process, Node runtime concerns

When adding a feature, put logic in the lowest layer that can express it, and expose it upward through narrow interfaces.

### Single Codebase, Multiple Surfaces
- The Next.js app must run unchanged in a browser tab and inside Electron.
- Anything that requires Node/filesystem/process APIs goes through server actions (web) or Electron IPC (desktop). The React components call the same higher-level functions in both cases — a thin transport adapter decides whether the call goes over HTTP or IPC.
- Avoid `electron`-only imports in client components.

## Planned Surface Features

- Project list & registration
- Asset browser (global storage + per-project)
- Mini git display (status / log / diff — read-mostly)
- Mini file editor (lightweight, not a full IDE)
- Manager chat/command surface
- Per-project agent sessions

These are user-facing scope notes, not implementation prescriptions — design each one to fit the layered architecture above.

## Commands

All commands are run from the repo root. Each maps to a Turbo pipeline that fans out to the right workspace packages.

```bash
pnpm install            # install all workspaces
pnpm dev                # web + desktop in parallel
pnpm dev:web            # Next.js only (http://localhost:3000)
pnpm dev:desktop        # Electron only (loads localhost:3000 in dev)
pnpm build              # builds all apps + packages
pnpm typecheck          # tsc --noEmit across every workspace
pnpm lint               # biome check
pnpm format             # biome format --write
```

There are no unit tests yet. Verification is `pnpm typecheck && pnpm lint && pnpm build`, plus a one-shot persistence smoke test:

```bash
# Persistence smoke test — confirms JSON store atomic writes survive a restart.
apps/desktop/node_modules/.bin/tsx packages/persistence/scripts/smoke.mjs
```

## Internal import convention

Workspace packages export their TypeScript source directly (`main: "./src/index.ts"`) and consumers re-bundle via Next's `transpilePackages` or `tsx` in dev. **Internal imports between files in the same package must be extensionless** (`./foo`, not `./foo.js`). Turbopack does not rewrite `.js` back to `.ts` in transpiled workspace packages — this will manifest as `Module not found: Can't resolve './foo.js'` at first request. Cross-package imports use the package name (`@the-manager/shared`), never relative paths.

## Zod schemas and `.default()`

`packages/persistence/src/schemas.ts` deliberately does **not** use `z.default(...)` on object fields, even though it's tempting. With `.default()`, the schema's input and output types diverge (`tags?: string[]` vs `tags: string[]`), which breaks `JsonStore<T extends z.ZodType<T>>`'s single generic. Provide complete defaults at the repo's `defaultValue` factory instead.
