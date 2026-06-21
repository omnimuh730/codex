import type { ElementType } from "react";
import { AppCard } from "../primitives";

export function SettingsSection({ section, icon: Icon, items }: {
  section: string;
  icon: ElementType;
  items: { label: string; value: string }[];
}) {
  return (
    <AppCard className="overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-secondary/30">
        <Icon size={14} className="text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{section}</h3>
      </div>
      <div className="divide-y divide-border/60">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between px-5 py-3.5 hover:bg-secondary/40 transition-colors gap-4">
            <span className="text-sm text-foreground shrink-0">{item.label}</span>
            <span className="font-['JetBrains_Mono'] tabular-nums text-xs text-muted-foreground font-medium text-right break-all">{item.value}</span>
          </div>
        ))}
      </div>
    </AppCard>
  );
}
