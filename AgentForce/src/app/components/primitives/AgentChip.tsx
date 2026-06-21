import { Bot } from "lucide-react";
import { agentChipStyle } from "../../lib/agent-colors";

export function AgentChip({ name }: { name: string }) {
  const s = agentChipStyle(name);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
      <Bot size={11} className="shrink-0 opacity-70" />
      {name}
    </span>
  );
}
