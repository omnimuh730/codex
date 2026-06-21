import { Loader2 } from "lucide-react";
import type { Screenshot } from "./types";

export function LiveRunScreenshot({ shot }: { shot: Screenshot | null }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-secondary/40 min-h-[180px] flex items-center justify-center">
      {shot ? (
        <img src={shot.dataUrl} alt={shot.label} className="w-full object-top" />
      ) : (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-12">
          <Loader2 size={14} className="animate-spin" />Waiting for first frame…
        </div>
      )}
    </div>
  );
}
