<div align="center">
  <img src="docs/assets/logo.png" alt="The Manager" width="128" height="128" />

  <h1>The Manager</h1>

  <p><strong>One control plane for every coding agent on your machine.</strong></p>

  <p>
    <a href="https://github.com/spksoft/the-manager/actions/workflows/ci.yml"><img src="https://github.com/spksoft/the-manager/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/spksoft/the-manager/releases"><img src="https://img.shields.io/github/v/release/spksoft/the-manager?include_prereleases&sort=semver" alt="Latest release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/spksoft/the-manager" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/node-%3E=22-brightgreen" alt="Node >= 22" />
    <img src="https://img.shields.io/badge/built%20with-Next.js%20%C2%B7%20Electron-black" alt="Next.js + Electron" />
  </p>
</div>

---

**The Manager** is a meta-agent app that puts every project on your laptop — and every CLI coding agent running inside them — behind a single window. Register a project, attach a long-lived `claude` (or `codex`, `gemini`) session to it, watch its terminal in real time, and let a privileged **Manager** agent fan work out across all of them.

It runs as a Next.js web app, an Electron desktop app, and a self-hosted server — from one codebase.

## Highlights

- **Per-project agent sessions.** Long-lived pty under `claude` (no `-p`), full interactive REPL streamed to the browser via xterm.js.
- **A Manager agent.** A separate, privileged `claude` session in its own working directory, ready to dispatch tasks across your projects.
- **Mini git pane.** Branch, status, recent log, per project — no leaving the window to `cd`.
- **Lightweight file editor.** CodeMirror 6 for in-app edits without booting a heavyweight IDE.
- **Shared assets.** A global storage area + per-project scopes for passing context between agents.
- **No API keys required.** The Manager talks to Claude through your installed `claude` CLI; bring your own login.

## Install

### Download (recommended)

Grab the latest signed-free DMG from [Releases](https://github.com/spksoft/the-manager/releases) and drag **The Manager.app** to Applications.

> Apple Silicon and Intel macOS only for now. Windows / Linux desktop builds are not yet shipped — use the web build below.

### Run from source

```bash
git clone https://github.com/spksoft/the-manager.git
cd the-manager
pnpm install
pnpm dev:web        # http://localhost:3000  (or `pnpm dev` to also launch Electron)
```

## Quick start

1. Make sure the `claude` CLI is installed and on your `PATH` (`claude --version`).
2. Launch The Manager.
3. Click **+** in the sidebar to register a project (any directory on disk).
4. Open the project — a `claude` session boots inside its working directory.
5. Switch to **Manager** at any time to issue cross-project commands.

## Configuration

Optional environment variables (copy `.env.example` → `.env.local`):

| Variable | Purpose | Default |
|---|---|---|
| `THE_MANAGER_HOME` | On-disk storage root | `~/.the-manager/` |
| `THE_MANAGER_CLAUDE_BIN` | Path to the `claude` CLI | found on `PATH` |
| `THE_MANAGER_CODEX_BIN` | Path to the `codex` CLI | found on `PATH` |
| `THE_MANAGER_GEMINI_BIN` | Path to the `gemini` CLI | found on `PATH` |
| `THE_MANAGER_DEV_URL` | URL the Electron window loads in dev | `http://localhost:3000` |

## Requirements

- **Node** `>= 22`
- **pnpm** `10`
- A working **`claude`** CLI on `PATH` (Anthropic account; no API key needed). Optional: `codex`, `gemini`.

## Documentation

- **Users** — you're reading it. See [Configuration](#configuration) and [Quick start](#quick-start) above.
- **Developers / contributors** — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) covers workspace layout, commands, conventions, smoke tests, and the release flow.
- **Architecture & design rationale** — [`CLAUDE.md`](CLAUDE.md) is the source of truth on layering, the CLI driver abstraction, and the "one app for all apps" model.
- **Changelog** — [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. Before opening a PR, please:

1. Read [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the workspace conventions.
2. Run `pnpm typecheck && pnpm lint && pnpm build` locally.
3. Run the smoke tests (`pnpm smoke:persistence` and `pnpm smoke`).

A pre-commit hook appends a one-line entry to `CHANGELOG.md` from your staged diff — no manual changelog edits required.

## License

[MIT](LICENSE) © Sippakorn Raksakiart
