import { forwardRef } from "react";
import { Send } from "lucide-react";
import { mono } from "../../lib/constants";

export const TerminalInput = forwardRef<HTMLInputElement, {
  input: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
}>(function TerminalInput({ input, onChange, onKeyDown, onSubmit }, ref) {
  return (
    <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0e1117" }}>
      <span className={`${mono} shrink-0`} style={{ fontSize: 13, color: "#e8442a" }}>$</span>
      <input
        ref={ref}
        value={input}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        placeholder="Type a command…"
        className={`${mono} flex-1 bg-transparent focus:outline-none`}
        style={{ fontSize: 13, color: "#e2e8f0", caretColor: "#e8442a" }}
      />
      <button
        onClick={onSubmit}
        className="shrink-0 p-1.5 rounded-lg transition-colors"
        style={{ color: input.trim() ? "#e8442a" : "#374151" }}
        disabled={!input.trim()}
      >
        <Send size={14} />
      </button>
    </div>
  );
});
