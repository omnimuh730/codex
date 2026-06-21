import { CheckCircle2, Loader2, X } from "lucide-react";
import type { ActiveRun } from "../../types";
import type { RunDone, RunJob, RunMeta } from "./types";

export function LiveRunHeader({ run, isReview, done, connected, job, meta, onClose }: {
  run: ActiveRun;
  isReview: boolean;
  done: RunDone | null;
  connected: boolean;
  job: RunJob | null;
  meta: RunMeta;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0" style={{ boxShadow: "0 2px 8px rgba(232,68,42,0.3)" }}>
          {done ? <CheckCircle2 size={18} className="text-white" /> : <Loader2 size={18} className="text-white animate-spin" />}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-foreground flex items-center gap-2 truncate">
            {run.agentName}
            <span className="text-xs font-medium text-muted-foreground">{isReview ? "run review" : "applying live"}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {job ? `Job ${job.index + 1}/${job.total} · ${job.title}${job.company ? " @ " + job.company : ""}`
              : meta.profileName ? `${meta.profileName}${meta.model ? ` · ${meta.model}` : ""}`
              : run.source ? `${run.source} · ${run.jobCount ?? 0} posted jobs` : run.url}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${connected ? (isReview ? "text-blue-600 bg-blue-50 border-blue-200" : "text-green-600 bg-green-50 border-green-200") : "text-muted-foreground bg-secondary border-border"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? (isReview ? "bg-blue-500" : "bg-green-500 animate-pulse") : "bg-gray-400"}`} />
          {isReview ? "Review" : connected ? "Live" : "…"}
        </span>
        <button onClick={onClose} className="w-8 h-8 rounded-xl bg-secondary hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
