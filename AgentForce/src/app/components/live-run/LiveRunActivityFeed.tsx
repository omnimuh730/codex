import { useEffect, useRef } from "react";
import { Activity, Loader2 } from "lucide-react";
import { mono } from "../../lib/constants";
import type { RunStep } from "./types";
import { LiveRunStepItem } from "./LiveRunStepItem";

export function LiveRunActivityFeed({ steps, isReview }: {
  steps: RunStep[];
  isReview: boolean;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [steps]);

  return (
    <div className="flex flex-col min-h-0 border-r border-border">
      <div className="px-5 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
        <Activity size={14} className="text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Agent activity</h4>
        <span className={`${mono} text-xs text-muted-foreground ml-auto`}>{steps.length} steps</span>
      </div>
      <div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5">
        {steps.map(s => (
          <LiveRunStepItem key={s.seq} step={s} />
        ))}
        {!steps.length && (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
            <Loader2 size={14} className="animate-spin" />
            {isReview ? "Loading run timeline…" : "Connecting to agent…"}
          </div>
        )}
      </div>
    </div>
  );
}
