import type { RunField } from "./types";

export function LiveRunFieldsList({ fields }: { fields: RunField[] }) {
  if (fields.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Filled fields</p>
      <div className="rounded-xl border border-border divide-y divide-border/60 overflow-hidden">
        {fields.map(f => (
          <div key={f.label} className="flex items-start justify-between gap-3 px-3.5 py-2 text-sm">
            <span className="text-muted-foreground shrink-0 max-w-[45%] truncate" title={f.label}>{f.label}</span>
            <span className="text-foreground font-medium text-right break-words flex items-center gap-1.5">
              {f.value}
              {f.source === "ai" && (
                <span className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded px-1 py-0.5 shrink-0">AI</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
