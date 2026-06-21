import { Hammer } from "lucide-react";
import type { RunSummary } from "../../hooks/use-dashboard";
import type { View } from "../../types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "../ui/sidebar";
import { AppSidebarNav } from "./AppSidebarNav";
import { AppSidebarRuns } from "./AppSidebarRuns";

export function AppSidebar({
  view,
  onViewChange,
  runs,
  errorCount,
  onOpenRun,
}: {
  view: View;
  onViewChange: (view: View) => void;
  runs: RunSummary[];
  errorCount: number;
  onOpenRun: (run: RunSummary) => void;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-1 py-2">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0" style={{ boxShadow: "0 2px 8px rgba(232,68,42,0.3)" }}>
            <Hammer size={15} className="text-white" />
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <div className="font-extrabold text-sidebar-foreground text-sm tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              BidForge
            </div>
            <div className="text-muted-foreground text-xs">Orchestrator v2.4</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <AppSidebarNav view={view} onViewChange={onViewChange} errorCount={errorCount} />
        <AppSidebarRuns runs={runs} onOpenRun={onOpenRun} />
      </SidebarContent>

      <SidebarFooter className="p-0">
        <SidebarRail />
      </SidebarFooter>
    </Sidebar>
  );
}
