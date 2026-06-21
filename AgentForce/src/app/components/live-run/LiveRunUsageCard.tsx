import { DollarSign } from "lucide-react";
import { mono } from "../../lib/constants";
import type { RunMeta, RunUsage } from "./types";

export function LiveRunUsageCard({ usage, meta }: { usage: RunUsage; meta: RunMeta }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        <DollarSign size={12} />Token usage · {usage.model || meta.model || "model"}
      </p>
      <div className="rounded-xl border border-border bg-secondary/30 px-3.5 py-3 grid grid-cols-2 gap-2 text-sm">
        <div><span className="text-muted-foreground">Input</span><div className={`${mono} font-semibold`}>{usage.inputTokens.toLocaleString()}</div></div>
        <div><span className="text-muted-foreground">Cached</span><div className={`${mono} font-semibold`}>{usage.cachedTokens.toLocaleString()}</div></div>
        <div><span className="text-muted-foreground">Output</span><div className={`${mono} font-semibold`}>{usage.outputTokens.toLocaleString()}</div></div>
        <div><span className="text-muted-foreground">Total</span><div className={`${mono} font-semibold`}>{usage.totalTokens.toLocaleString()}</div></div>
        <div className="col-span-2 pt-1 border-t border-border/60">
          <span className="text-muted-foreground">Cost</span>
          <div className={`${mono} font-bold text-primary`}>{usage.costLabel || `$${usage.costUsd.toFixed(6)}`}</div>
        </div>
      </div>
    </div>
  );
}
