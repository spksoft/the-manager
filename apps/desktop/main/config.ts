/**
 * Single source of truth for the desktop app's default network configuration.
 *
 * 48723 / 48724 are fixed values in the IPv4 user range (1024–65535) chosen
 * to avoid the most common dev-server ports (3000, 5173, 8080, 9000, etc.).
 *
 * Dev and production are kept on distinct ports so they can coexist: if a
 * user installs the packaged app and also runs `pnpm dev:web`, both servers
 * should bind cleanly and the dev browser tab points at the dev bundle, not
 * the stale packaged one.
 *
 * The production embedded server prefers the persisted port from settings;
 * `DEFAULT_PORT` is the bootstrap value used the first time the app runs.
 */
export const DEFAULT_PORT = 48723;
/** Port used by `pnpm dev:web` and the dev-mode Electron window. */
export const DEV_PORT = 48724;

/** Builds the dev-mode URL with env overrides intact. */
export function devUrl(): string {
  if (process.env.THE_MANAGER_DEV_URL) return process.env.THE_MANAGER_DEV_URL;
  const port = process.env.PORT ? Number(process.env.PORT) : DEV_PORT;
  return `http://localhost:${port}`;
}
