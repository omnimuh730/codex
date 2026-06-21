import { AlertTriangle, Plus, RefreshCw, Wifi, WifiOff } from "lucide-react";
import type { ProfileOption } from "../../hooks/use-dashboard";
import type { HealthData } from "../../hooks/use-dashboard";
import type { View } from "../../types";
import { VIEW_TITLES } from "../../lib/constants";
import { SidebarTrigger } from "../ui/sidebar";
import { AppButton } from "../primitives";

export function AppHeader({
  view,
  profileId,
  profiles,
  onProfileChange,
  health,
  errorCount,
  loading,
  onRefresh,
  onDeploy,
}: {
  view: View;
  profileId: string | null;
  profiles: ProfileOption[];
  onProfileChange: (id: string | null) => void;
  health: HealthData | null;
  errorCount: number;
  loading: boolean;
  onRefresh: () => void;
  onDeploy: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-border shrink-0" style={{ boxShadow: "0 1px 0 var(--border)" }}>
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-1" />
        <h1 className="text-base font-bold text-foreground" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {VIEW_TITLES[view]}
        </h1>
        <span className="text-muted-foreground text-xs hidden sm:block">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={profileId || ""}
          onChange={e => onProfileChange(e.target.value || null)}
          className="text-xs rounded-xl border border-border bg-white px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 max-w-[160px] truncate"
        >
          <option value="">All profiles</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.fullName || p.name}</option>
          ))}
        </select>
        <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${health?.ok ? "text-green-600 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"}`}>
          {health?.ok ? <Wifi size={11} /> : <WifiOff size={11} />}
          <span className="hidden sm:inline">{health?.ok ? "Connected" : "Offline"}</span>
        </div>
        {errorCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
            <AlertTriangle size={11} />{errorCount} Error{errorCount > 1 ? "s" : ""}
          </div>
        )}
        <AppButton variant="default" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />Refresh
        </AppButton>
        <AppButton variant="primary" size="sm" onClick={onDeploy}>
          <Plus size={12} />Deploy Agent
        </AppButton>
      </div>
    </header>
  );
}
