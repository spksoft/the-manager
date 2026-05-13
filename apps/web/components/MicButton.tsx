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

const AUTO_TRANSLATE_KEY = "tm.stt.autoTranslateEn";
const LANG_KEY = "tm.stt.lang";

export function MicButton({ onResult }: MicButtonProps) {
  const [lang, setLang] = useState<Lang>("en-US");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translating, setTranslating] = useState(false);
  const recRef = useRef<SR | null>(null);
  const pttActiveRef = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Persist mic settings (language + auto-translate) across sessions so the
  // user doesn't have to re-pick them every reload.
  useEffect(() => {
    try {
      setAutoTranslate(localStorage.getItem(AUTO_TRANSLATE_KEY) === "1");
      const savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang === "en-US" || savedLang === "th-TH") setLang(savedLang);
    } catch {
      /* localStorage blocked — fall back to defaults */
    }
  }, []);
  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next: Lang = l === "en-US" ? "th-TH" : "en-US";
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const toggleAutoTranslate = useCallback(() => {
    setAutoTranslate((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_TRANSLATE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const autoTranslateRef = useRef(autoTranslate);
  useEffect(() => {
    autoTranslateRef.current = autoTranslate;
  }, [autoTranslate]);

  const emitResult = useCallback(async (raw: string) => {
    if (!autoTranslateRef.current) {
      onResultRef.current(raw);
      return;
    }
    setTranslating(true);
    try {
      const res = await fetch("/api/stt/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { text?: string };
      const translated = (json.text ?? "").trim();
      onResultRef.current(translated.length > 0 ? translated : raw);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Fall back to the original transcript so the user's voice still lands.
      onResultRef.current(raw);
    } finally {
      setTranslating(false);
    }
  }, []);

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
      if (final.trim().length > 0) void emitResult(final.trim());
    };
    rec.onerror = (e) => {
      const code = (e as { error?: string }).error ?? "speech-recognition error";
      // `no-speech` and `aborted` are routine cancellations — don't show as errors.
      if (code !== "no-speech" && code !== "aborted") setError(code);
      // Defer the listening-off state to onend so push-to-talk can restart
      // without flickering the UI between utterances.
    };
    rec.onend = () => {
      setInterim("");
      // Push-to-talk: as long as the user is still holding Ctrl+M, restart the
      // recogniser. Web Speech runs in single-utterance mode (continuous=false)
      // so it auto-stops on each pause — without this, holding the keys would
      // only capture the first utterance.
      if (pttActiveRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* restart failed — fall through and surface as stopped */
        }
      }
      setListening(false);
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
  }, [lang, emitResult]);

  const supported = typeof window !== "undefined" && getSRCtor() !== null;

  const startListening = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return false;
    setError(null);
    try {
      rec.start();
      setListening(true);
      return true;
    } catch (e) {
      // `start()` throws synchronously if the recogniser is already running —
      // treat that as a successful no-op so push-to-talk's keydown handler
      // doesn't surface a scary message on a double-fire.
      const msg = e instanceof Error ? e.message : String(e);
      if (/already started/i.test(msg)) return true;
      setError(msg);
      return false;
    }
  }, []);

  const stopListening = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* ignore — already stopped */
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  // Push-to-talk: hold Ctrl+M to record, release to stop. Captured at the
  // window level so it works even when xterm has focus. NOTE: terminals
  // interpret Ctrl+M as carriage return — capturing it here means that exact
  // combo no longer reaches the pty, but the Enter key still does.
  useEffect(() => {
    if (!supported) return;
    const isM = (e: KeyboardEvent) =>
      e.ctrlKey && (e.code === "KeyM" || e.key.toLowerCase() === "m");
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isM(e)) return;
      e.preventDefault();
      if (e.repeat || pttActiveRef.current) return;
      if (startListening()) pttActiveRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Release on either Ctrl or M lifting — whichever comes first ends PTT.
      if (!pttActiveRef.current) return;
      if (e.key === "Control" || e.code === "KeyM" || e.key.toLowerCase() === "m") {
        pttActiveRef.current = false;
        stopListening();
      }
    };
    const onBlur = () => {
      if (!pttActiveRef.current) return;
      pttActiveRef.current = false;
      stopListening();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [supported, startListening, stopListening]);

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
        onClick={toggleLang}
        title={`Recognition language (${lang}) — click to toggle`}
        aria-label={`Toggle language, currently ${lang}`}
        className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200"
      >
        {lang === "en-US" ? "EN" : "TH"}
      </button>
      <button
        type="button"
        onClick={toggleAutoTranslate}
        aria-pressed={autoTranslate}
        title={
          autoTranslate
            ? "Auto-translate to English is ON — recognised text is sent through claude -p before submission"
            : "Auto-translate to English is OFF — recognised text is sent as-is"
        }
        aria-label={`Auto-translate to English ${autoTranslate ? "on" : "off"}`}
        className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
          autoTranslate
            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
            : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        →EN
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop speaking" : "Start speaking"}
        title={
          listening
            ? "Stop listening"
            : "Click to speak — output is auto-sent. Hold Ctrl+M to push-to-talk."
        }
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
      {translating && <span className="text-[11px] italic text-emerald-400">translating…</span>}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
