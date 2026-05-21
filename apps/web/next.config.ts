import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Read the repo-root version so the Preferences panel can render it. The
// release script bumps the root + desktop package.json together, so the root
// is the canonical app version (apps/web/package.json is unrelated).
const rootPkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
  version: string;
};

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
  },
  // Self-contained server bundle for the Electron-packaged desktop build.
  output: "standalone",
  // Dev gets its own build dir so its per-project lock file
  // (`<distDir>/dev/lock`) doesn't collide with the packaged desktop app's
  // standalone server running on the prod port — without this, starting
  // `pnpm dev:web` while the desktop app is open fails with "Another next
  // dev server is already running" even though the ports differ.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Workspace packages ship as TypeScript source; let Next transpile them.
  transpilePackages: [
    "@the-manager/core",
    "@the-manager/drivers",
    "@the-manager/editor",
    "@the-manager/git",
    "@the-manager/persistence",
    "@the-manager/shared",
    "@the-manager/ui",
  ],
  // Embedded inside Electron at runtime; React strict mode helps surface
  // surprises before they show up in the desktop build.
  reactStrictMode: true,
  // Native node modules used in route handlers must not be bundled.
  serverExternalPackages: [
    "@lydell/node-pty",
    "proper-lockfile",
    "simple-git",
    "write-file-atomic",
  ],
  // Force-include the arch-specific pty.node prebuild in the standalone trace.
  // Next's automatic tracer can miss optionalDependencies loaded via runtime
  // arch detection inside @lydell/node-pty's loader.
  outputFileTracingIncludes: {
    "/api/projects/*/terminal/**": [
      "../../node_modules/.pnpm/@lydell+node-pty-darwin-arm64@*/node_modules/@lydell/node-pty-darwin-arm64/**",
    ],
  },
  // The app is a single-user control plane that the user exposes through
  // tunnels (ngrok / cloudflare / etc.) when running on a VPS or personal
  // machine. Tunnel hostnames change every restart, so we list wildcards for
  // the common providers rather than a literal host. All meaningful state
  // lives on the server already (see `apps/web/lib/runtime.ts` and the
  // ui-state / file-drafts repos), so loosening the dev cross-origin guard
  // here doesn't expose anything beyond what the tunnel itself already does.
  allowedDevOrigins: [
    "*",
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "*.trycloudflare.com",
    "*.loca.lt",
  ],
};

export default config;
