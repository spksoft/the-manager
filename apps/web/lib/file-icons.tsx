"use client";

import {
  File,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Lock,
  Terminal,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export interface IconSpec {
  Icon: IconComponent;
  className: string;
}

const EXT_MAP: Record<string, IconSpec> = {
  ts: { Icon: FileCode, className: "text-sky-400" },
  tsx: { Icon: FileCode, className: "text-sky-400" },
  js: { Icon: FileCode, className: "text-yellow-400" },
  jsx: { Icon: FileCode, className: "text-yellow-400" },
  mjs: { Icon: FileCode, className: "text-yellow-400" },
  cjs: { Icon: FileCode, className: "text-yellow-400" },
  json: { Icon: FileJson, className: "text-amber-300" },
  md: { Icon: FileText, className: "text-zinc-300" },
  mdx: { Icon: FileText, className: "text-zinc-300" },
  txt: { Icon: FileText, className: "text-zinc-400" },
  py: { Icon: FileCode, className: "text-emerald-400" },
  rs: { Icon: FileCode, className: "text-orange-400" },
  go: { Icon: FileCode, className: "text-cyan-400" },
  rb: { Icon: FileCode, className: "text-red-400" },
  java: { Icon: FileCode, className: "text-orange-300" },
  c: { Icon: FileCode, className: "text-blue-400" },
  h: { Icon: FileCode, className: "text-blue-300" },
  cpp: { Icon: FileCode, className: "text-blue-400" },
  cc: { Icon: FileCode, className: "text-blue-400" },
  hpp: { Icon: FileCode, className: "text-blue-300" },
  cs: { Icon: FileCode, className: "text-violet-400" },
  php: { Icon: FileCode, className: "text-indigo-400" },
  swift: { Icon: FileCode, className: "text-pink-400" },
  kt: { Icon: FileCode, className: "text-purple-400" },
  html: { Icon: FileCode, className: "text-orange-400" },
  htm: { Icon: FileCode, className: "text-orange-400" },
  css: { Icon: FileCode, className: "text-blue-400" },
  scss: { Icon: FileCode, className: "text-pink-400" },
  sass: { Icon: FileCode, className: "text-pink-400" },
  sql: { Icon: FileCode, className: "text-amber-400" },
  xml: { Icon: FileCode, className: "text-orange-300" },
  yaml: { Icon: FileText, className: "text-rose-300" },
  yml: { Icon: FileText, className: "text-rose-300" },
  toml: { Icon: FileText, className: "text-rose-300" },
  sh: { Icon: Terminal, className: "text-emerald-300" },
  bash: { Icon: Terminal, className: "text-emerald-300" },
  zsh: { Icon: Terminal, className: "text-emerald-300" },
  png: { Icon: ImageIcon, className: "text-violet-300" },
  jpg: { Icon: ImageIcon, className: "text-violet-300" },
  jpeg: { Icon: ImageIcon, className: "text-violet-300" },
  gif: { Icon: ImageIcon, className: "text-violet-300" },
  webp: { Icon: ImageIcon, className: "text-violet-300" },
  svg: { Icon: ImageIcon, className: "text-yellow-300" },
  ico: { Icon: ImageIcon, className: "text-violet-200" },
  csv: { Icon: FileSpreadsheet, className: "text-green-400" },
  xlsx: { Icon: FileSpreadsheet, className: "text-green-400" },
  xls: { Icon: FileSpreadsheet, className: "text-green-400" },
  lock: { Icon: Lock, className: "text-zinc-500" },
  env: { Icon: Lock, className: "text-yellow-500" },
};

const FILENAME_MAP: Record<string, IconSpec> = {
  "package.json": { Icon: FileJson, className: "text-red-400" },
  "package-lock.json": { Icon: Lock, className: "text-red-400/70" },
  "pnpm-lock.yaml": { Icon: Lock, className: "text-amber-400/70" },
  "yarn.lock": { Icon: Lock, className: "text-blue-400/70" },
  "tsconfig.json": { Icon: FileJson, className: "text-sky-500" },
  "biome.json": { Icon: FileJson, className: "text-emerald-400" },
  "biome.jsonc": { Icon: FileJson, className: "text-emerald-400" },
  Dockerfile: { Icon: FileType, className: "text-cyan-400" },
  ".gitignore": { Icon: FileText, className: "text-orange-300" },
  ".dockerignore": { Icon: FileText, className: "text-orange-300" },
  ".env": { Icon: Lock, className: "text-yellow-500" },
  ".env.local": { Icon: Lock, className: "text-yellow-500" },
  "README.md": { Icon: FileText, className: "text-zinc-200" },
  "CLAUDE.md": { Icon: FileText, className: "text-amber-300" },
  LICENSE: { Icon: FileText, className: "text-zinc-400" },
};

export function fileIcon(name: string): IconSpec {
  if (FILENAME_MAP[name]) return FILENAME_MAP[name];
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? { Icon: File, className: "text-zinc-500" };
}

export function folderIcon(open: boolean): IconSpec {
  return { Icon: open ? FolderOpen : Folder, className: "text-sky-300/80" };
}
