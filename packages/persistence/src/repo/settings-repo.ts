import { paths } from "../paths";
import { type SettingsFile, SettingsSchema } from "../schemas";
import { JsonStore } from "../store";

export const defaultSettings = (): SettingsFile => ({
  version: 1,
  data: {
    recentProjectIds: [],
    windowState: null,
    flags: {},
    network: { preferredPort: null },
  },
});

/**
 * Forward-compat migration: settings fields added in later commits won't be
 * present in older settings.json files. Fill them with defaults before Zod
 * parses so a fresh install and an upgrade both read the same shape.
 */
export const migrateSettings = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object" || !("data" in raw)) return raw;
  const data = (raw as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") return raw;
  if (!("network" in data)) {
    return { ...raw, data: { ...data, network: { preferredPort: null } } };
  }
  return raw;
};

/** Constructs the shared settings store. Safe to call from multiple processes. */
export function createSettingsStore(): JsonStore<SettingsFile> {
  return new JsonStore(paths.settings(), SettingsSchema, defaultSettings, migrateSettings);
}
