"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Lang = "en-US" | "th-TH";

interface MicButtonProps {
  /** Called with each finalised transcript. The caller decides whether to append `\r`. */
  onResult: (text: string) => void;
}

/**
 * Browser Web Speech API microphone toggle. Chrome / Edge ship it under either
 * `SpeechRecognition` or `webkitSpeechRecognition`; Safari + Firefox don't, so
 * we degrade gracefully to a disabled button with a tooltip.
 *
 * Single-shot mode (continuous = false) — each press records one utterance and
 * fires `onResult` once the recogniser settles, then auto-stops. A separate
 * EN / TH pill toggles the recognition language without restarting.
 */

// SpeechRecognition isn't in lib.dom.d.ts; the minimum surface we need:
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
interface SRCtor {
  new (): SR;
}

function getSRCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (
    (w.SpeechRecognition as SRCtor | undefined) ??
    (w.webkitSpeechRecognition as SRCtor | undefined) ??
    null
  );
}

export function MicButton({ onResult }: MicButtonProps) {
  const [lang, setLang] = useState<Lang>("en-US");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SR | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Build / rebuild the recogniser whenever the language changes. Recogniser
  // state is closure-trapped, so we attach handlers fresh.
  useEffect(() => {
    const SRCtor = getSRCtor();
    if (!SRCtor) return;
    const rec = new SRCtor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      const results = (
        e as {
          results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
        }
      ).results;
      let final = "";
      let inter = "";
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r) continue;
        const transcript = r[0]?.transcript ?? "";
        if (r.isFinal) final += transcript;
        else inter += transcript;
      }
      setInterim(inter);
      if (final.trim().length > 0) onResultRef.current(final.trim());
    };
    rec.onerror = (e) => {
      const code = (e as { error?: string }).error ?? "speech-recognition error";
      // `no-speech` and `aborted` are routine cancellations — don't show as errors.
      if (code !== "no-speech" && code !== "aborted") setError(code);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* ignore — already stopped */
      }
      recRef.current = null;
    };
  }, [lang]);

  const supported = typeof window !== "undefined" && getSRCtor() !== null;

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [listening]);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Speech recognition isn't supported in this browser — try Chrome or Edge"
        aria-label="Speech recognition unavailable"
        className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-sm text-zinc-600 opacity-60"
      >
        🎤
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setLang((l) => (l === "en-US" ? "th-TH" : "en-US"))}
        title={`Recognition language (${lang}) — click to toggle`}
        aria-label={`Toggle language, currently ${lang}`}
        className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200"
      >
        {lang === "en-US" ? "EN" : "TH"}
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop speaking" : "Start speaking"}
        title={listening ? "Stop listening" : "Click to speak — output is auto-sent"}
        className={`rounded-md border px-2 py-1 text-sm transition-colors ${
          listening
            ? "animate-mic-pulse border-red-500/60 bg-red-500/20 text-red-300"
            : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        🎤
      </button>
      {interim && (
        <span className="max-w-[160px] truncate text-[11px] italic text-zinc-500">{interim}</span>
      )}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
