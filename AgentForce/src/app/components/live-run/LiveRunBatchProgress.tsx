import { CheckCircle2 } from "lucide-react";
import type { RunBatch, RunDone, JobView } from "./types";

// Per-job traffic light: each dot is colored by that job's status (processing / success /
// failed / skipped / review) and is clickable to switch the panel to that job's activity.
function dotClass(job: JobView | undefined, isCurrent: boolean, batchDone: boolean): string {
  const r = job?.result;
  if (r === "submitted" || r === "submitted_unconfirmed") return "bg-green-500 border-green-500";
  if (r === "review_pending") return "bg-amber-400 border-amber-400";
  if (r === "error" || r === "needs_correction") return "bg-red-500 border-red-500";
  if (r === "needs_login") return "bg-violet-500 border-violet-500";
  if (r === "skipped" || r === "stopped") return "bg-slate-400 border-slate-400";
  if (r) return "bg-cyan-500 border-cyan-500";
  if (isCurrent && !batchDone) return "bg-primary border-primary animate-pulse"; // processing
  return "bg-transparent border-muted-foreground/40"; // queued
}

export function LiveRunBatchProgress({ batch, jobs, currentIndex, selectedIndex, done, onSelect }: {
  batch: RunBatch;
  jobs: JobView[];
  currentIndex: number;
  selectedIndex: number;
  done: RunDone | null;
  onSelect: (index: number) => void;
}) {
  if (!batch || batch.total <= 1) return null;
  const finished = jobs.filter(j => j?.result).length;

  return (
    <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border shrink-0 overflow-x-auto bg-secondary/30">
      <span className="text-xs font-semibold text-muted-foreground shrink-0">
        Auto-bid {batch.source} · {finished}/{batch.total} done
      </span>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: batch.total }).map((_, i) => {
          const job = jobs[i];
          const isCurrent = i === currentIndex && !done;
          const isSelected = i === selectedIndex;
          const title = `Job ${i + 1}${job?.title ? ": " + job.title : ""}` +
            (job?.result ? ` · ${job.result}` : isCurrent ? " · processing" : " · queued");
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              title={title}
              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-transform hover:scale-125 ${dotClass(job, isCurrent, !!done)} ${isSelected ? "ring-2 ring-primary/60 ring-offset-1 ring-offset-card scale-110" : ""}`}
            >
              {(job?.result === "submitted" || job?.result === "submitted_unconfirmed") && <CheckCircle2 size={9} className="text-white" />}
            </button>
          );
        })}
      </div>
      {selectedIndex !== currentIndex && !done && (
        <button onClick={() => onSelect(currentIndex)} className="text-xs font-medium text-primary hover:underline shrink-0 ml-auto">
          Follow live →
        </button>
      )}
    </div>
  );
}
