import React from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  Hammer,
  Zap,
} from "lucide-react";
import type { JobStatus, LogEntry } from "../types";

export function jobStatusStyle(s: JobStatus): { dot: string; badge: string; text: string; label: string } {
  switch (s) {
    case "succeeded":
      return { dot: "bg-green-500", badge: "bg-green-50  border-green-200", text: "text-green-700", label: "Succeeded" };
    case "scheduled":
      return { dot: "bg-blue-500", badge: "bg-blue-50   border-blue-200", text: "text-blue-700", label: "Scheduled" };
    case "in_progress":
      return { dot: "bg-primary animate-pulse", badge: "bg-primary/8 border-primary/20", text: "text-primary", label: "In progress" };
    case "review":
      return { dot: "bg-amber-500", badge: "bg-amber-50  border-amber-200", text: "text-amber-700", label: "Review" };
    case "failed":
      return { dot: "bg-red-400", badge: "bg-red-50    border-red-200", text: "text-red-700", label: "Failed" };
    // legacy fallbacks
    case "applied":
      return { dot: "bg-green-500", badge: "bg-green-50  border-green-200", text: "text-green-700", label: "Succeeded" };
    case "posted":
      return { dot: "bg-blue-500", badge: "bg-blue-50   border-blue-200", text: "text-blue-700", label: "Scheduled" };
    case "review_pending":
      return { dot: "bg-amber-500", badge: "bg-amber-50  border-amber-200", text: "text-amber-700", label: "Review" };
  }
}

export function runStatusStyle(s: string): { dot: string; label: string; labelClass: string } {
  switch (s) {
    case "running":
      return { dot: "bg-green-500", label: "Running", labelClass: "text-green-700 bg-green-50 border-green-200" };
    case "done":
      return { dot: "bg-blue-500", label: "Done", labelClass: "text-blue-700 bg-blue-50 border-blue-200" };
    case "error":
      return { dot: "bg-red-500", label: "Error", labelClass: "text-red-700 bg-red-50 border-red-200" };
    case "interrupted":
      return { dot: "bg-amber-500", label: "Interrupted", labelClass: "text-amber-700 bg-amber-50 border-amber-200" };
    default:
      return { dot: "bg-gray-400", label: s, labelClass: "text-gray-600 bg-gray-50 border-gray-200" };
  }
}

export function logStyle(t: LogEntry["type"]) {
  switch (t) {
    case "success":
      return "text-green-600";
    case "error":
      return "text-red-600";
    case "warn":
      return "text-amber-600";
    default:
      return "text-slate-600";
  }
}

export function runStepIcon(level: string) {
  switch (level) {
    case "success":
      return React.createElement(CheckCircle2, { size: 14, className: "text-green-500 shrink-0 mt-0.5" });
    case "error":
      return React.createElement(AlertTriangle, { size: 14, className: "text-red-500 shrink-0 mt-0.5" });
    case "warn":
      return React.createElement(AlertTriangle, { size: 14, className: "text-amber-500 shrink-0 mt-0.5" });
    case "ai":
      return React.createElement(Zap, { size: 14, className: "text-violet-500 shrink-0 mt-0.5" });
    case "action":
      return React.createElement(Hammer, { size: 14, className: "text-primary shrink-0 mt-0.5" });
    case "job":
      return React.createElement(Bot, { size: 14, className: "text-primary shrink-0 mt-0.5" });
    default:
      return React.createElement(CircleDot, { size: 14, className: "text-blue-500 shrink-0 mt-0.5" });
  }
}

export function activityIcon(t: LogEntry["type"]) {
  switch (t) {
    case "success":
      return React.createElement(CheckCircle2, { size: 13, className: "text-green-500 shrink-0 mt-0.5" });
    case "error":
      return React.createElement(AlertTriangle, { size: 13, className: "text-red-500 shrink-0 mt-0.5" });
    case "warn":
      return React.createElement(AlertTriangle, { size: 13, className: "text-amber-500 shrink-0 mt-0.5" });
    default:
      return React.createElement(CircleDot, { size: 13, className: "text-blue-500 shrink-0 mt-0.5" });
  }
}

export function terminalLineColor(t: string) {
  switch (t) {
    case "command":
      return "#e8442a";
    case "success":
      return "#22c55e";
    case "error":
      return "#f87171";
    case "warn":
      return "#fbbf24";
    case "system":
      return "#94a3b8";
    default:
      return "#a3b8cc";
  }
}
