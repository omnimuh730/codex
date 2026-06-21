import type { RunSummary, JobRow, DashboardData } from "../../hooks/use-dashboard";
import { mono } from "../../lib/constants";
import { AppCard } from "../primitives";
import { TerminalShell } from "../terminal/TerminalView";

export function TerminalPageView({
  runs,
  dashboard,
  appliedJobs,
  runningCount,
  onDeploy,
}: {
  runs: RunSummary[];
  dashboard: DashboardData | null;
  appliedJobs: JobRow[];
  runningCount: number;
  onDeploy: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="text-sm font-bold text-foreground">Orchestrator Terminal</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Inspect runs and applications. Type{" "}
            <code className={`${mono} text-primary bg-primary/8 px-1.5 py-0.5 rounded text-xs`}>help</code> for commands.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {runningCount} run{runningCount === 1 ? "" : "s"} active
          </div>
        </div>
      </div>
      <TerminalShell runs={runs} dashboard={dashboard} appliedJobs={appliedJobs} onDeploy={onDeploy} />
      <AppCard className="p-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Quick Reference</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            { cmd: "status", desc: "Show system overview" },
            { cmd: "list agents", desc: "All deploy runs" },
            { cmd: "list applications", desc: "Recently applied jobs" },
          ].map(({ cmd, desc }) => (
            <div key={cmd} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary hover:bg-muted transition-colors">
              <code className={`${mono} text-xs text-primary font-medium`}>{cmd}</code>
              <span className="text-xs text-muted-foreground">— {desc}</span>
            </div>
          ))}
        </div>
      </AppCard>
    </>
  );
}
