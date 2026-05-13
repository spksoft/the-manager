# The Manager 

A meta-agent app for orchestrating CLI coding agents (Claude Code first; Codex / Gemini CLIs later) across multiple projects. Ships as a Next.js web app, an Electron desktop app, and a self-hosted Node server — all from one codebase.

See [`CLAUDE.md`](./CLAUDE.md) for architecture, principles, and design rationale.

## What it does

- Register projects (any directory on disk) and spawn a CLI agent inside each.
- Watch each agent's pty output in a real terminal (xterm.js), send input, kill it.
- A privileged **Manager** agent — a long-lived `claude` session in its own cwd — that you can use as a control plane across projects.
- A mini git display per project (status / branch / recent log).
- A lightweight file browser and editor (CodeMirror 6) for in-app edits.
- A shared **Assets** browser (global storage + per-project scope).
- Settings persisted to a single JSON tree under `~/.the-manager/`.

## Requirements

- Node `>= 22`
- `pnpm 10`
- The `claude` CLI on your `PATH` (and `codex` / `gemini` if you want to use those drivers). The Manager itself runs through `claude` — there is **no** Anthropic API key required.

## Quick start

```bash
pnpm install
pnpm dev            # runs web + desktop in parallel
pnpm dev:web        # web only (http://localhost:3000)
pnpm dev:desktop    # desktop only (Electron window pointing at the web dev server)
```

Open `http://localhost:3000`, click **+** in the sidebar to register a project, then click **Manager** (or your project) and start chatting.

## Configuration

The Manager reads optional environment variables:

| Var | Purpose |
|---|---|
| `THE_MANAGER_HOME` | Override the on-disk storage root (default: `~/.the-manager/`). |
| `THE_MANAGER_CLAUDE_BIN` | Override the path to the `claude` CLI (default: looked up on `PATH`). |
| `THE_MANAGER_CODEX_BIN` | Same, for Codex. |
| `THE_MANAGER_GEMINI_BIN` | Same, for Gemini. |
| `THE_MANAGER_DEV_URL` | URL the Electron window loads in dev (default: `http://localhost:3000`). |

## Workspace

| Path | Purpose |
|---|---|
| `apps/web` | Next.js App Router — UI + Route Handlers (the "server") |
| `apps/desktop` | Electron shell that loads `apps/web` |
| `packages/core` | Domain layer (pure) |
| `packages/drivers` | CLI driver abstraction + pty-backed `ClaudeDriver` / `CodexDriver` / `GeminiDriver` |
| `packages/persistence` | JSON-file storage (`JsonStore`, repos) |
| `packages/git` | `simple-git` wrapper for the mini git display |
| `packages/ui` | Shared component primitives |
| `packages/editor` | CodeMirror 6 wrapper |
| `packages/shared` | Types, errors, constants |

## Verifying the install

```bash
pnpm typecheck
pnpm lint
pnpm build

# Persistence smoke test — confirms atomic writes survive a restart.
pnpm smoke:persistence

# API smoke — boots `next start` on a free port and exercises every route.
pnpm smoke
```

## License

[MIT](./LICENSE).
