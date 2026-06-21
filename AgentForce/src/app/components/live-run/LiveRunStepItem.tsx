import { runStepIcon } from "../../lib/status-styles";
import type { RunStep } from "./types";

export function LiveRunStepItem({ step }: { step: RunStep }) {
  return (
    <div className="flex gap-2.5">
      {runStepIcon(step.level)}
      <div className="min-w-0">
        <div className="text-sm text-foreground leading-snug">{step.title}</div>
        {step.detail && (
          <div className={`text-xs mt-0.5 leading-snug break-words ${step.level === "ai" ? "text-violet-600" : "text-muted-foreground"}`}>
            {step.detail}
          </div>
        )}
      </div>
    </div>
  );
}
