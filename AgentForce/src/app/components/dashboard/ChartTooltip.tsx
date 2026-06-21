import { mono } from "../../lib/constants";

export function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 text-xs" style={{ boxShadow: "var(--shadow-md)" }}>
      <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      {payload.map(p => (
        <p key={p.name} className={`${mono} font-semibold`} style={{ color: p.color }}>
          {p.value}{p.name === "rate" ? "%" : ""}
        </p>
      ))}
    </div>
  );
}
