import { useState, useEffect, useRef, useCallback } from "react";
import type { RunSummary, JobRow, DashboardData } from "../../hooks/use-dashboard";
import type { TerminalLine } from "../../types";
import { HELP_TEXT } from "./constants";

export function useTerminalCommands(
  runs: RunSummary[],
  dashboard: DashboardData | null,
  appliedJobs: JobRow[],
  onDeploy: () => void,
) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "sys0", content: "AgentForce Orchestrator Terminal", type: "system" },
    { id: "sys1", content: `Connected — ${runs.filter(r => r.status === "running").length} run(s) active`, type: "system" },
    { id: "sys2", content: "Type 'help' for available commands.", type: "system" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const lineId = useRef(10);

  const addLine = useCallback((content: string, type: TerminalLine["type"]) => {
    setLines(prev => [...prev, { id: `l${lineId.current++}`, content, type }]);
  }, []);

  const runCommand = useCallback((raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    addLine(`$ ${cmd}`, "command");
    setHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);

    const parts = cmd.toLowerCase().split(/\s+/);
    const first = parts[0];

    if (first === "clear") { setLines([]); return; }
    if (first === "help") { HELP_TEXT.split("\n").forEach(l => addLine(l, "output")); return; }

    if (first === "status") {
      addLine(`System status — ${new Date().toLocaleTimeString()}`, "output");
      addLine(`  Active runs    : ${dashboard?.activeRuns ?? runs.filter(r => r.status === "running").length}`, "output");
      addLine(`  Applied today  : ${dashboard?.appliedToday ?? 0}`, "output");
      addLine(`  Posted jobs    : ${dashboard?.posted ?? 0}`, "output");
      addLine(`  In-flight jobs : ${dashboard?.inFlightJobs ?? 0}`, "output");
      return;
    }

    if (cmd === "list agents") {
      addLine("ID              NAME                 STATUS    SOURCE      JOBS  SUBMITTED", "output");
      addLine("─".repeat(72), "output");
      runs.forEach(r => {
        const row = `${r.id.slice(0, 14).padEnd(16)} ${r.agentName.slice(0, 20).padEnd(21)} ${r.status.padEnd(9)} ${r.source.slice(0, 11).padEnd(11)} ${String(r.jobCount).padEnd(5)} ${r.submitted}`;
        addLine(row, r.status === "error" ? "error" : "output");
      });
      if (!runs.length) addLine("  (no deploy runs yet — use Deploy Agent in the UI)", "output");
      return;
    }

    if (cmd === "list applications" || cmd === "list bids") {
      addLine("TITLE                                    COMPANY              SOURCE", "output");
      addLine("─".repeat(72), "output");
      appliedJobs.slice(0, 20).forEach(j => {
        addLine(`${j.title.slice(0, 40).padEnd(41)} ${j.company.slice(0, 20).padEnd(21)} ${j.source}`, "output");
      });
      if (!appliedJobs.length) addLine("  (no applied jobs yet)", "output");
      return;
    }

    if (parts[0] === "deploy") {
      addLine("Use the Deploy Agent button in the dashboard to start a run.", "warn");
      onDeploy();
      return;
    }

    if (parts[0] === "pause" || parts[0] === "resume" || parts[0] === "restart") {
      addLine("Run lifecycle is automatic — pause/resume/restart are not supported.", "warn");
      return;
    }

    addLine(`command not found: ${first}. Type 'help' for available commands.`, "error");
  }, [addLine, appliedJobs, dashboard, onDeploy, runs]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { runCommand(input); setInput(""); }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setInput(history[next] ?? "");
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? "" : history[next]);
    }
  }

  const clearLines = useCallback(() => setLines([]), []);

  return { lines, input, setInput, handleKey, runCommand, clearLines };
}
