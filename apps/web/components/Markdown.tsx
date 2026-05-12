"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant text as Markdown — headings, lists, code fences, tables,
 * links. Sized for inline chat bubbles, so the styling is intentionally
 * conservative (small headings, modest spacing).
 *
 * Memoized: the same text re-renders on every streamed token in the parent's
 * state map, and `react-markdown` is non-trivial to re-parse on each keystroke.
 */
function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 mb-1 text-base font-semibold text-zinc-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-2 mb-1 text-sm font-semibold text-zinc-50">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold text-zinc-100">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-1.5 mb-1 text-sm font-medium text-zinc-100">{children}</h4>
  ),
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-emerald-400 underline decoration-emerald-700 underline-offset-2 hover:text-emerald-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-zinc-800" />,
  strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-100">{children}</em>,
  // react-markdown v10 no longer passes an `inline` prop on the code renderer.
  // The signal is: block code carries a `language-*` className (from fenced
  // blocks) AND is always wrapped in <pre>; inline code has neither.
  code: ({ className, children }: CodeProps) => {
    const isBlock = /\blanguage-/.test(className ?? "");
    if (!isBlock) {
      return (
        <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[12px] text-zinc-200">
          {children}
        </code>
      );
    }
    return (
      <code
        className={`block w-full overflow-x-auto whitespace-pre font-mono text-[12px] leading-relaxed text-zinc-200 ${className ?? ""}`}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-zinc-950 px-3 py-2">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-zinc-800 px-2 py-1 text-left font-semibold text-zinc-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-zinc-800 px-2 py-1 align-top text-zinc-300">{children}</td>
  ),
};

type CodeProps = {
  className?: string;
  children?: React.ReactNode;
};
