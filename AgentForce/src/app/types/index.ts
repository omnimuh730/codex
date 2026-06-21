import type { JobRow } from "../hooks/use-dashboard";

export type JobStatus = JobRow["status"];
export type View = "dashboard" | "agents" | "terminal" | "settings";

export interface LogEntry {
  id: string;
  time: string;
  agentName: string;
  event: string;
  type: "info" | "success" | "warn" | "error";
}

export interface TerminalLine {
  id: string;
  content: string;
  type: "command" | "output" | "success" | "error" | "warn" | "system";
}

export interface ActiveRun {
  runId: string;
  agentName: string;
  url: string;
  profileName?: string;
  model?: string;
  source?: string;
  jobCount?: number;
  mode: "live" | "review";
}

export type JobTabKey = "in_progress" | "succeeded" | "failed" | "scheduled";

export interface DeployOptions {
  name: string;
  autoSubmit: boolean;
  profileId: string;
  model: string;
  source: string;
  startIndex: number;
  endIndex: number;
}
