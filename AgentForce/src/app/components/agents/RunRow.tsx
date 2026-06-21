import { Activity } from "lucide-react";
import type { RunSummary } from "../../hooks/use-dashboard";
import { mono } from "../../lib/constants";
import { runStatusStyle } from "../../lib/status-styles";
import { formatAgo } from "../../utils/time";
import { AppButton } from "../primitives";

export function RunRow({ run, onOpen }: { run: RunSummary; onOpen: (run: RunSummary) => void }) {
  const st = runStatusStyle(run.status);
  const isRunning = run.status === "running";

  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition-colors group">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="relative shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${st.dot} ${run.status === "running" ? "animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-foreground text-sm truncate">{run.agentName}</div>
          <div className="text-xs text-muted-foreground">{run.source} · {run.profileName}</div>
        </div>
      </div>
      <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${st.labelClass} shrink-0`}>
        {st.label}
      </span>
      <div className="hidden md:flex items-center gap-6 shrink-0">
        <div className="text-center">
          <div className={`${mono} text-sm font-semibold text-foreground`}>{run.jobCount}</div>
          <div className="text-xs text-muted-foreground">jobs</div>
        </div>
        <div className="text-center">
          <div className={`${mono} text-sm font-semibold text-green-600`}>{run.submitted}</div>
          <div className="text-xs text-muted-foreground">submitted</div>
        </div>
        <div className="text-center">
          <div className={`${mono} text-xs text-muted-foreground`}>{formatAgo(run.startedAt)} ago</div>
          <div className="text-xs text-muted-foreground">started</div>
        </div>
      </div>
      <AppButton size="sm" variant="outline" onClick={() => onOpen(run)} className="opacity-0 group-hover:opacity-100 transition-opacity">
        <Activity size={12} />{isRunning ? "Monitor" : "Review"}
      </AppButton>
    </div>
  );
}
