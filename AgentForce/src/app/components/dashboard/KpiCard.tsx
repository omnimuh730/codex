import React from "react";
import { AppCard } from "../primitives";
import { mono } from "../../lib/constants";

export function KpiCard({ label, value, sub, icon: Icon, color = "text-primary" }: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ElementType;
  color?: string;
}) {
  return (
    <AppCard className="p-5 hover:border-primary/20 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
            <Icon size={15} className={color} />
          </div>
        )}
      </div>
      <div className={`${mono} text-2xl font-semibold ${color} leading-none mb-1.5`}>{value}</div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </AppCard>
  );
}
