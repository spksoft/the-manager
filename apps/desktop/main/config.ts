/**
 * Single source of truth for the desktop app's default network configuration.
 *
 * 48723 is a fixed value in the IPv4 user range (1024–65535) chosen to avoid
 * the most common dev-server ports (3000, 5173, 8080, 9000, etc.). The
 * production embedded server prefers the persisted port from settings; this
 * constant is the bootstrap value used the first time the app runs, and the
 * dev URL fallback when `pnpm dev:web` runs Next on the default port.
 */
export const DEFAULT_PORT = 48723;

/** Builds the dev-mode URL with env overrides intact. */
export function devUrl(): string {
  if (process.env.THE_MANAGER_DEV_URL) return process.env.THE_MANAGER_DEV_URL;
  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  return `http://localhost:${port}`;
}
