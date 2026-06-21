import type { JobTabKey } from "../../types";
import { mono } from "../../lib/constants";

export function JobTableTabs({ tabs, tab, onTabChange }: {
  tabs: { key: JobTabKey; label: string; count: number }[];
  tab: JobTabKey;
  onTabChange: (key: JobTabKey) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl p-0.5 bg-secondary overflow-x-auto">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onTabChange(t.key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium transition-all shrink-0 ${
            tab === t.key ? "bg-white text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
          <span className={`${mono} text-xs px-1.5 py-0.5 rounded-md ${tab === t.key ? "bg-secondary text-muted-foreground" : "bg-white/50 text-muted-foreground"}`}>
            {t.count}
          </span>
        </button>
      ))}
    </div>
  );
}
