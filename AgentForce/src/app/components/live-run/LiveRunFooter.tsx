import { AlertTriangle, CheckCircle2, CircleDot, Loader2 } from "lucide-react";
import { PHASE_LABEL } from "./constants";
import { AppButton } from "../primitives";
import type { RunDone } from "./types";

export function LiveRunFooter({ done, isReview, status, onClose }: {
  done: RunDone | null;
  isReview: boolean;
  status: string;
  onClose: () => void;
}) {
  const resultStyle = done?.result === "submitted" || done?.result === "batch_complete" ? "text-green-700 bg-green-50 border-green-200"
    : done?.result === "review_pending" ? "text-amber-700 bg-amber-50 border-amber-200"
    : done?.result === "error" || done?.result === "needs_correction" ? "text-red-700 bg-red-50 border-red-200"
    : done?.result === "needs_login" ? "text-violet-700 bg-violet-50 border-violet-200"
    : "text-cyan-700 bg-cyan-50 border-cyan-200";

  const resultLabel = done && (
    done.result === "submitted" ? "Submitted ✓"
      : done.result === "batch_complete" ? `Batch done · ${done.submitted ?? 0}/${done.total ?? 0} submitted`
      : done.result === "review_pending" ? "Stopped at review"
      : done.result === "needs_correction" ? "Form rejected"
      : done.result === "needs_login" ? "Login required"
      : done.result === "skipped" ? "Skipped"
      : done.result === "error" ? "Error" : done.result);

  return (
    <div className="px-6 py-3.5 border-t border-border shrink-0 flex items-center gap-3">
      {done ? (
        <>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${resultStyle}`}>
            {done.result === "submitted" || done.result === "batch_complete" ? <CheckCircle2 size={14} /> : done.result === "error" ? <AlertTriangle size={14} /> : <CircleDot size={14} />}
            {done.result === "submitted" ? "Submitted ✓"
              : done.result === "batch_complete" ? `Batch done · ${done.submitted ?? 0}/${done.total ?? 0} submitted`
              : done.result === "review_pending" ? "Stopped at review"
              : done.result === "error" ? "Error" : done.result}
          </span>
          <span className="text-sm text-muted-foreground truncate flex-1">{done.message}</span>
          <AppButton variant="primary" size="sm" onClick={onClose}>Done</AppButton>
        </>
      ) : isReview ? (
        <>
          <CircleDot size={14} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground flex-1">Historical run — read-only timeline</span>
          <AppButton variant="primary" size="sm" onClick={onClose}>Close</AppButton>
        </>
      ) : (
        <>
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="text-sm text-muted-foreground flex-1">Agent is working — {PHASE_LABEL[status] || status}…</span>
          <AppButton variant="default" size="sm" onClick={onClose}>Run in background</AppButton>
        </>
      )}
    </div>
  );
}
