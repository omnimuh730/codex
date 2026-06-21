import { Bot, CheckCircle2, AlertTriangle, TrendingUp, Plus, Zap } from "lucide-react";
import type { RunSummary } from "../../hooks/use-dashboard";
import { AppButton, AppCard } from "../primitives";
import { KpiCard } from "../dashboard/KpiCard";
import { RunRow } from "./RunRow";

export function AgentsView({
  runs,
  successRate,
  onDeploy,
  onOpenRun,
}: {
  runs: RunSummary[];
  successRate: number;
  onDeploy: () => void;
  onOpenRun: (run: RunSummary) => void;
}) {
  const runningCount = runs.filter(r => r.status === "running").length;
  const errorCount = runs.filter(r => r.status === "error").length;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Zap} label="Running" value={`${runningCount}`} sub="active runs" color="text-green-600" />
        <KpiCard icon={CheckCircle2} label="Finished" value={`${runs.filter(r => r.status === "done").length}`} sub="completed" />
        <KpiCard icon={AlertTriangle} label="Errors" value={`${errorCount}`} sub="need attention" color="text-red-600" />
        <KpiCard icon={TrendingUp} label="Success Rate" value={`${successRate}%`} sub="from audit log" color="text-primary" />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">Deploy Runs</h2>
        <AppButton variant="primary" size="sm" onClick={onDeploy}>
          <Plus size={13} />Deploy New Agent
        </AppButton>
      </div>

      <AppCard className="overflow-hidden">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <Bot size={28} className="opacity-40" />
            <p className="text-sm">No deploy runs yet — click Deploy Agent to start</p>
          </div>
        ) : runs.map(run => (
          <RunRow key={run.id} run={run} onOpen={onOpenRun} />
        ))}
      </AppCard>
    </>
  );
}
