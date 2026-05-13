export type DriverId = "claude" | "codex" | "gemini" | "shell";

export type AgentStatus = "starting" | "running" | "exited" | "killed" | "error";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type AssetScope = "global" | { projectId: string };
