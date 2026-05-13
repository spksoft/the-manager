"use client";

import type { GraphNode } from "@the-manager/git";
import { GitCommitVerticalIcon, PencilIcon } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useGraph } from "../../../lib/hooks";
import { useGitActions } from "../GitActionsContext";
import { parseRefDecoration, shortDate, shortHash } from "../helpers";
import { RowMenu } from "../left/RowMenu";

interface CommitGraphProps {
  projectId: string;
  selectedHash: string | null;
  /** null = working-tree row selected, hash = commit selected */
  onSelect: (hash: string | null) => void;
  hasWorkingChanges: boolean;
  workingChangesCount: number;
}

const ROW_H = 28;
const LANE_W = 14;
const DOT_R = 4;

// Soft palette cycled by lane index — keeps lanes visually distinct without
// flashy colors. Avoid pure red/green (reserved for diff +/-).
const LANE_COLORS = [
  "#60a5fa", // blue-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#a78bfa", // violet-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
  "#fb923c", // orange-400
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? "#60a5fa";
}

export function CommitGraph({
  projectId,
  selectedHash,
  onSelect,
  hasWorkingChanges,
  workingChangesCount,
}: CommitGraphProps) {
  const { data, isLoading } = useGraph(projectId, 500);
  const nodes = data?.nodes ?? [];

  if (isLoading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
        Loading commit graph…
      </div>
    );
  }

  // Explicit pixel height for the Virtuoso scroll container — relying on flex
  // through overflow-y-auto parents can collapse to 0 and render nothing.
  // Cap at ~20 rows (the rest virtualise on scroll); floor at 3 rows so a
  // brand-new repo with 1 commit doesn't look broken.
  const itemsHeight = Math.max(3, Math.min(nodes.length, 20)) * ROW_H;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
        Graph ({nodes.length}
        {nodes.length >= 500 ? "+" : ""})
      </div>
      {/* Working-tree synthetic row */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex w-full flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-left text-xs transition-colors ${
          selectedHash === null ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/60"
        }`}
        style={{ height: ROW_H }}
      >
        <PencilIcon className="h-3 w-3 text-amber-400" />
        <span className="truncate">
          Working tree
          {hasWorkingChanges && (
            <span className="ml-2 text-amber-400">
              {workingChangesCount} change{workingChangesCount === 1 ? "" : "s"}
            </span>
          )}
          {!hasWorkingChanges && <span className="ml-2 text-zinc-600">clean</span>}
        </span>
      </button>
      <div style={{ height: itemsHeight }}>
        <Virtuoso
          style={{ height: "100%" }}
          data={nodes}
          totalCount={nodes.length}
          fixedItemHeight={ROW_H}
          itemContent={(index, node) => (
            <GraphRow
              node={node}
              nextNode={nodes[index + 1]}
              selected={selectedHash === node.hash}
              onClick={() => onSelect(node.hash)}
            />
          )}
        />
      </div>
    </div>
  );
}

interface GraphRowProps {
  node: GraphNode;
  nextNode: GraphNode | undefined;
  selected: boolean;
  onClick: () => void;
}

function GraphRow({ node, nextNode, selected, onClick }: GraphRowProps) {
  const actions = useGitActions();
  // SVG canvas needs to be wide enough to draw this node + every edge that
  // dives down to the next row. The widest endpoint dictates the canvas.
  const endpoints = [node.lane, ...node.parentLanes];
  if (nextNode) endpoints.push(nextNode.lane);
  const maxLane = Math.max(...endpoints, 0);
  const width = (maxLane + 1) * LANE_W + LANE_W;

  // For each parentLane index, we need its on-screen row position. If the
  // immediate next row is this node's first parent, the line lands at that
  // row's lane. We approximate: draw a straight segment from this node's
  // center to the next row's parent-lane position (if it matches), otherwise
  // a half-line continuing down off the bottom.
  const cx = node.lane * LANE_W + LANE_W / 2;
  const cy = ROW_H / 2;
  const refs = parseRefDecoration(node.refs);

  return (
    // biome-ignore lint/a11y/useSemanticElements: nested <button> is invalid; this row contains a <button> (the RowMenu trigger).
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex w-full cursor-pointer items-center gap-2 border-b border-zinc-900/40 px-2 text-left text-xs transition-colors ${
        selected ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/40"
      }`}
      style={{ height: ROW_H }}
    >
      <svg
        width={width}
        height={ROW_H}
        viewBox={`0 0 ${width} ${ROW_H}`}
        className="flex-shrink-0 overflow-visible"
        role="presentation"
      >
        <title>commit graph row</title>
        {/* Outgoing edges to parents. nextNode is the next on-screen row, so
            edges from this node to a parent landing on that row are drawn
            inside this <svg>. Edges to parents further down render as a
            half-line going off the bottom — overflow:visible makes the line
            visible while the actual continuation is drawn by the child row
            when it scrolls into view. */}
        {node.parentLanes.map((pLane, i) => {
          const px = pLane * LANE_W + LANE_W / 2;
          // If the immediate next row is the parent commit, terminate at its
          // center. Otherwise dive past the bottom.
          const parentHash = node.parents[i] ?? "";
          const isImmediate = nextNode && nextNode.hash === parentHash;
          const endY = isImmediate ? ROW_H + ROW_H / 2 : ROW_H;
          return (
            <path
              key={`p-${parentHash || pLane}`}
              d={`M ${cx} ${cy} L ${cx} ${cy + 2} L ${px} ${endY}`}
              stroke={laneColor(pLane)}
              strokeWidth={1.4}
              fill="none"
            />
          );
        })}
        <circle
          cx={cx}
          cy={cy}
          r={DOT_R}
          fill={laneColor(node.lane)}
          stroke="#0c0c0d"
          strokeWidth={1.5}
        />
      </svg>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {refs.map((r) => (
          <span
            key={r.name}
            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
              r.isHead
                ? "bg-emerald-500/15 text-emerald-300"
                : r.kind === "tag"
                  ? "bg-amber-500/15 text-amber-300"
                  : r.kind === "remote"
                    ? "bg-zinc-800 text-zinc-400"
                    : "bg-blue-500/15 text-blue-300"
            }`}
          >
            {r.name}
          </span>
        ))}
        <span className="truncate text-zinc-200">{node.subject || "(no subject)"}</span>
      </div>
      <span className="hidden flex-shrink-0 text-[10px] text-zinc-500 sm:inline">
        {shortHash(node.hash)}
      </span>
      <span className="hidden flex-shrink-0 text-[10px] text-zinc-500 md:inline">
        {node.author}
      </span>
      <span className="hidden flex-shrink-0 text-[10px] text-zinc-500 md:inline">
        {shortDate(node.date)}
      </span>
      <GitCommitVerticalIcon className="hidden h-3 w-3 flex-shrink-0 text-zinc-700 lg:inline" />
      <RowMenu
        ariaLabel={`Actions for commit ${shortHash(node.hash)}`}
        items={[
          {
            label: "Create branch here…",
            onClick: () => actions.openCreateBranchFromCommit(node),
          },
          {
            label: "Reset to this commit…",
            danger: true,
            onClick: () => actions.openResetForNode(node),
          },
        ]}
      />
    </div>
  );
}
