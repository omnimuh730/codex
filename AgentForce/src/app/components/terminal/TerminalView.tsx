import { useRef } from "react";
import type { RunSummary, JobRow, DashboardData } from "../../hooks/use-dashboard";
import { TerminalChrome } from "./TerminalChrome";
import { TerminalOutput } from "./TerminalOutput";
import { TerminalInput } from "./TerminalInput";
import { useTerminalCommands } from "./useTerminalCommands";

export function TerminalShell({ runs, dashboard, appliedJobs, onDeploy }: {
  runs: RunSummary[];
  dashboard: DashboardData | null;
  appliedJobs: JobRow[];
  onDeploy: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { lines, input, setInput, handleKey, runCommand, clearLines } = useTerminalCommands(
    runs, dashboard, appliedJobs, onDeploy,
  );

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col border border-border"
      style={{ background: "#0e1117", boxShadow: "var(--shadow-lg)", minHeight: 520 }}
      onClick={() => inputRef.current?.focus()}
    >
      <TerminalChrome onClear={clearLines} />
      <TerminalOutput lines={lines} />
      <TerminalInput
        ref={inputRef}
        input={input}
        onChange={setInput}
        onKeyDown={handleKey}
        onSubmit={() => { runCommand(input); setInput(""); }}
      />
    </div>
  );
}
