"use client";

import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";

export type SupportedLanguage = "javascript" | "typescript" | "json" | "markdown" | "plaintext";

export interface MiniEditorProps {
  value: string;
  language?: SupportedLanguage;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

function extensionsFor(lang: SupportedLanguage): Extension[] {
  switch (lang) {
    case "javascript":
      return [javascript({ jsx: true })];
    case "typescript":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    default:
      return [];
  }
}

/**
 * Lightweight CodeMirror 6 wrapper for the in-app file editor. Not an IDE —
 * just enough for inspecting / making small edits to project files.
 */
export function MiniEditor({
  value,
  language = "plaintext",
  onChange,
  readOnly = false,
  height = "100%",
}: MiniEditorProps) {
  return (
    <CodeMirror
      value={value}
      height={height}
      readOnly={readOnly}
      theme={oneDark}
      extensions={extensionsFor(language)}
      onChange={onChange}
    />
  );
}
