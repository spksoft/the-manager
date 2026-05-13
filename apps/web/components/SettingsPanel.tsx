"use client";

import type { DriverId } from "@the-manager/shared";
import { Button, cn, Sheet } from "@the-manager/ui";
import { useEffect, useState } from "react";
import { useSettings } from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const DRIVERS: { id: DriverId; label: string; hint: string; ready: boolean }[] = [
  { id: "claude", label: "Claude Code", hint: "Anthropic", ready: true },
  { id: "codex", label: "Codex CLI", hint: "OpenAI · soon", ready: false },
  { id: "gemini", label: "Gemini CLI", hint: "Google · soon", ready: false },
];

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { data: settings, error, mutate } = useSettings();

  // defaultDriver is stored in flags["defaultDriver"] as a string-typed boolean workaround.
  // The settings schema only supports flags: Record<string, boolean>, so we store
  // the driver selection separately in component state and encode it via flags.
  const [defaultDriver, setDefaultDriver] = useState<DriverId>("claude");
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Sync from server settings — read defaultDriver from flags
  useEffect(() => {
    if (!settings) return;
    // We encode the driver as individual boolean flags: flags["driver:claude"] etc.
    const drivers: DriverId[] = ["claude", "codex", "gemini"];
    for (const d of drivers) {
      if (settings.data.flags[`driver:${d}`]) {
        setDefaultDriver(d);
        return;
      }
    }
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setSaveErr(null);
    setSavedJustNow(false);
    try {
      // Build flags: clear old driver flags, set new one
      const flags: Record<string, boolean> = {
        "driver:claude": false,
        "driver:codex": false,
        "driver:gemini": false,
        [`driver:${defaultDriver}`]: true,
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await mutate();
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 1500);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      const flags: Record<string, boolean> = {
        "driver:claude": true,
        "driver:codex": false,
        "driver:gemini": false,
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setDefaultDriver("claude");
      await mutate();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      side="right"
      ariaLabel="Settings"
    >
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close settings">
          Close
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {error && <ErrorBanner message={`Failed to load settings: ${String(error)}`} />}
        {saveErr && <ErrorBanner message={saveErr} onDismiss={() => setSaveErr(null)} />}

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">Default agent CLI</h3>
            <p className="mt-0.5 text-xs text-zinc-500">Used for new projects.</p>
          </div>
          <div role="radiogroup" aria-label="Default agent CLI" className="flex flex-col gap-1.5">
            {DRIVERS.map((d) => {
              const selected = d.id === defaultDriver;
              return (
                // biome-ignore lint/a11y/useSemanticElements: visual radio list — kept as <button role=radio> so the existing styled layout (label + hint + dot) works without rewriting against native input styling.
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={!d.ready}
                  disabled={!d.ready}
                  onClick={() => d.ready && setDefaultDriver(d.id)}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    !d.ready && "cursor-not-allowed opacity-50",
                    selected && d.ready
                      ? "border-emerald-500/40 bg-emerald-500/10 text-zinc-50"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:bg-zinc-900",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-3 w-3 rounded-full border",
                        selected ? "border-emerald-400 bg-emerald-400" : "border-zinc-600",
                      )}
                    />
                    {d.label}
                  </span>
                  <span className="text-xs text-zinc-500">{d.hint}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={resetToDefaults}
              disabled={saving}
              className="text-zinc-400 hover:text-zinc-100"
            >
              Reset to defaults
            </Button>
            <div className="flex items-center gap-2">
              {savedJustNow && (
                <span aria-live="polite" className="text-xs text-emerald-400">
                  ✓ Saved
                </span>
              )}
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-7 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-200">Storage root</h3>
          <p className="text-xs text-zinc-500">
            Global storage location. Override with{" "}
            <code className="font-mono">THE_MANAGER_HOME</code>.
          </p>
          <code className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-xs text-zinc-300">
            ~/.the-manager/
          </code>
        </section>

        <section className="mt-7 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-200">More</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {["Theme", "Keyboard shortcuts", "Telemetry"].map((label) => (
              <li
                key={label}
                className="flex items-center justify-between rounded-md border border-dashed border-zinc-800 px-3 py-2 text-zinc-400"
              >
                <span>{label}</span>
                <span className="text-xs text-zinc-600">Coming soon</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  );
}
