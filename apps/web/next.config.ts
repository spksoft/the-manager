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
};

export default config;
