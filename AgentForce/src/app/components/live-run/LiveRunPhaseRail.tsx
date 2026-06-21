import { CheckCircle2, ChevronRight, CircleDot, Loader2 } from "lucide-react";
import { PHASES, PHASE_LABEL } from "./constants";
import type { RunDone } from "./types";

export function LiveRunPhaseRail({ status, done, phaseIdx }: {
  status: string;
  done: RunDone | null;
  phaseIdx: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
      {PHASES.map((p, i) => (
        <div key={p} className="flex items-center gap-1.5 shrink-0">
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            done && (done.result === "submitted" || done.result === "batch_complete" || i < PHASES.length - 1) ? "text-green-700 bg-green-50 border-green-200"
            : i === phaseIdx ? "text-primary bg-primary/8 border-primary/20"
            : i < phaseIdx ? "text-green-700 bg-green-50 border-green-200"
            : "text-muted-foreground bg-secondary border-border"}`}>
            {i < phaseIdx || (done && done.result === "submitted") ? <CheckCircle2 size={11} /> : i === phaseIdx ? <Loader2 size={11} className="animate-spin" /> : <CircleDot size={11} />}
            {PHASE_LABEL[p] || p}
          </span>
          {i < PHASES.length - 1 && <ChevronRight size={12} className="text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  );
}
