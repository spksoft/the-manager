# @the-manager/desktop

Electron shell that loads the Next.js app.

## Layout

- `main/` — Electron main process (BrowserWindow, lifecycle, embedded server boot)
- `preload/` — `contextBridge` exposing privileged ops to the renderer
- `dist/` — compiled output (Electron main is CJS, not ESM)

## Dev

The desktop shell expects the Next.js dev server to be reachable. Either:

```bash
# Option A: run both at once from the repo root
pnpm dev

# Option B: split shells
pnpm dev:web          # terminal 1 — http://localhost:3000
pnpm dev:desktop      # terminal 2 — builds main+preload, then runs electron
```

The Electron main process polls `/api/health` before loading the URL, so it
won't race the dev server's startup. Override the target URL with the
`THE_MANAGER_DEV_URL` env var if needed.

Electron's main process cannot hot-reload — if you change anything under
`main/` or `preload/`, re-run `pnpm dev:desktop`. The Next.js renderer reloads
on save as usual.

## Production

`pnpm package` runs `electron-builder --dir` after compiling main+preload.
The packaged app still expects to find the Next.js bundle on disk; the
`extraResources` entry in `electron-builder.yml` is the wiring point for
that. For now the desktop app is intended to be used against a separately
served `apps/web` build.
