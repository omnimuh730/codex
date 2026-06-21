import { Send } from "lucide-react";

export function AutoSubmitToggle({ autoSubmit, onToggle }: {
  autoSubmit: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 bg-secondary/40 cursor-pointer">
      <div>
        <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Send size={13} className="text-primary" />Auto-submit when complete
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">Off = fill everything but stop at the review screen</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${autoSubmit ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${autoSubmit ? "translate-x-5" : ""}`}
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }}
        />
      </button>
    </label>
  );
}
