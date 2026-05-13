export type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "json"
  | "markdown"
  | "html"
  | "css"
  | "sass"
  | "python"
  | "yaml"
  | "toml"
  | "rust"
  | "go"
  | "php"
  | "cpp"
  | "java"
  | "sql"
  | "xml"
  | "shell"
  | "plaintext";

const EXT_TO_LANG: Record<string, SupportedLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "sass",
  sass: "sass",
  py: "python",
  pyi: "python",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  rs: "rust",
  go: "go",
  php: "php",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  java: "java",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

const FILENAME_TO_LANG: Record<string, SupportedLanguage> = {
  Dockerfile: "shell",
  Makefile: "shell",
  ".gitignore": "plaintext",
  ".dockerignore": "plaintext",
};

export function detectLanguage(filename: string): SupportedLanguage {
  if (FILENAME_TO_LANG[filename]) return FILENAME_TO_LANG[filename];
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}
