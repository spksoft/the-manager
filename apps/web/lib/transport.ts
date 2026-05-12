"use client";

/**
 * Surface-agnostic call site. Components import `transport.xyz()` regardless of
 * whether they're running in a browser tab or inside Electron's renderer.
 *
 * - In a browser, the implementation uses `fetch` against the Next.js Route
 *   Handlers in this same app.
 * - In Electron's renderer, certain calls (file dialogs, fs picks, OS notifications)
 *   are redirected through `window.theManager.*` which the preload script
 *   installs via `contextBridge`. Agent streaming still goes over HTTP because
 *   the embedded Next.js server is the same one a remote web client would talk to.
 *
 * Phase 0: only `health()` is real. Everything else throws so layering errors
 * surface early rather than as wrong-shape responses.
 */

type Bridge = {
  pickDirectory(): Promise<string | null>;
};

declare global {
  interface Window {
    theManager?: Bridge;
  }
}

function getBridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  return window.theManager ?? null;
}

export const transport = {
  async health(): Promise<{ ok: boolean; phase: number }> {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) throw new Error(`health: ${res.status}`);
    return res.json();
  },

  async pickDirectory(): Promise<string | null> {
    const bridge = getBridge();
    if (bridge) return bridge.pickDirectory();
    // Web fallback: not implemented in Phase 0. The web surface will eventually
    // accept a typed path instead of a native picker.
    throw new Error("pickDirectory is only available in the desktop app for now.");
  },
};
