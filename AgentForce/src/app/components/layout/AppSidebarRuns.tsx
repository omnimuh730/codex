import type { RunSummary } from "../../hooks/use-dashboard";
import { mono } from "../../lib/constants";
import { runStatusStyle } from "../../lib/status-styles";
import { formatAgo } from "../../utils/time";
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent } from "../ui/sidebar";

export function AppSidebarRuns({ runs, onOpenRun }: {
  runs: RunSummary[];
  onOpenRun: (run: RunSummary) => void;
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Runs</SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="space-y-0.5 max-h-40 overflow-y-auto px-1">
          {runs.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">No deploy runs yet</p>
          )}
          {runs.slice(0, 8).map(r => {
            const st = runStatusStyle(r.status);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenRun(r)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${st.dot} ${r.status === "running" ? "animate-pulse" : ""}`} />
                <span className="text-xs text-sidebar-foreground truncate flex-1">{r.agentName}</span>
                <span className={`${mono} text-muted-foreground shrink-0`} style={{ fontSize: 10 }}>{formatAgo(r.startedAt)}</span>
              </button>
            );
          })}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
