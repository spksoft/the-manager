import type { NextConfig } from "next";

const config: NextConfig = {
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
