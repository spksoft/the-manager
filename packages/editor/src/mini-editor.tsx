"use client";

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type Extension, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useRef } from "react";
import type { SupportedLanguage } from "./detect";

export type { SupportedLanguage } from "./detect";

export interface MiniEditorProps {
  value: string;
  language?: SupportedLanguage;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  /** If set, scroll/select this 1-based line on mount or when it changes. */
  initialLine?: number;
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
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "sass":
      return [sass()];
    case "python":
      return [python()];
    case "yaml":
      return [yaml()];
    case "toml":
      return [StreamLanguage.define(toml)];
    case "rust":
      return [rust()];
    case "go":
      return [go()];
    case "php":
      return [php()];
    case "cpp":
      return [cpp()];
    case "java":
      return [java()];
    case "sql":
      return [sql()];
    case "xml":
      return [xml()];
    case "shell":
      return [StreamLanguage.define(shell)];
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
  initialLine,
}: MiniEditorProps) {
  const ref = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    if (!initialLine) return;
    const view = ref.current?.view;
    if (!view) return;
    const doc = view.state.doc;
    const line = Math.min(Math.max(1, initialLine), doc.lines);
    const info = doc.line(line);
    view.dispatch({
      selection: { anchor: info.from, head: info.from },
      effects: EditorView.scrollIntoView(info.from, { y: "center" }),
    });
  }, [initialLine]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height={height}
      readOnly={readOnly}
      theme={oneDark}
      extensions={extensionsFor(language)}
      onChange={onChange}
      // @uiw/react-codemirror wraps .cm-editor in an unsized <div class="cm-theme">.
      // Without an explicit height here, long files break the 100% height chain
      // and .cm-scroller can't scroll — the wrapper grows to content instead.
      style={{ height, width: "100%" }}
    />
  );
}
