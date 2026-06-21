import { Trash2, Copy } from "lucide-react";
import { mono } from "../../lib/constants";

export function TerminalChrome({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ background: "#1a1f2a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-amber-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <span className={`${mono} text-xs ml-3`} style={{ color: "#64748b" }}>bidforge — orchestrator-terminal</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onClear} className="p-1.5 rounded-lg transition-colors" style={{ color: "#64748b" }} title="Clear">
          <Trash2 size={13} />
        </button>
        <button className="p-1.5 rounded-lg transition-colors" style={{ color: "#64748b" }} title="Copy output">
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}
