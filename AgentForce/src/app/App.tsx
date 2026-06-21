import { useState, useCallback } from "react";
import React from "react";
import { useDashboard, type RunSummary } from "./hooks/use-dashboard";
import type { View, ActiveRun, DeployOptions, LogEntry } from "./types";
import { now } from "./utils/time";
import { SidebarProvider, SidebarInset } from "./components/ui/sidebar";
import { AppSidebar } from "./components/layout/AppSidebar";
import { AppHeader } from "./components/layout/AppHeader";
import { AppFooter } from "./components/layout/AppFooter";
import { DashboardView } from "./components/dashboard/DashboardView";
import { AgentsView } from "./components/agents/AgentsView";
import { TerminalPageView } from "./components/terminal/TerminalPageView";
import { SettingsView } from "./components/settings/SettingsView";
import { DeployModal } from "./components/deploy/DeployModal";
import { LiveRunPanel } from "./components/live-run/LiveRunPanel";

export default function App() {
  const {
    profileId, setProfileId, profiles, dashboard, runs, activity, dashboardJobs,
    health, loading, error, refresh, prependActivity, successRate,
  } = useDashboard();

  const [view, setView] = useState<View>("dashboard");
  const [showDeploy, setShowDeploy] = useState(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

  const addLog = useCallback((agentName: string, event: string, type: LogEntry["type"]) => {
    prependActivity({ agentName, event, type, time: now() });
  }, [prependActivity]);

  async function startRun(opts: DeployOptions) {
    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `Deploy failed (${res.status}). Is the agent backend running?`);

    addLog(opts.name, `Deployed for ${data.profileName || "profile"} — auto-bid ${data.jobCount || 0} ${opts.source} jobs`, "success");
    setShowDeploy(false);
    setActiveRun({
      runId: data.runId,
      agentName: opts.name,
      url: (data.jobs && data.jobs[0]?.url) || "",
      profileName: data.profileName,
      model: data.model || opts.model,
      source: data.source || opts.source,
      jobCount: data.jobCount || (data.jobs ? data.jobs.length : 1),
      mode: "live",
    });
    refresh();
  }

  function openRun(run: RunSummary) {
    setActiveRun({
      runId: run.id,
      agentName: run.agentName,
      url: run.url,
      profileName: run.profileName,
      model: run.model,
      source: run.source,
      jobCount: run.jobCount,
      mode: run.status === "running" ? "live" : "review",
    });
  }

  const runningCount = runs.filter(r => r.status === "running").length;
  const errorCount = runs.filter(r => r.status === "error").length;
  const inFlightJobs = dashboard?.inFlightJobs ?? 0;
  const postedCount = dashboard?.posted ?? 0;

  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-screen overflow-hidden bg-background w-full" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <AppSidebar
          view={view}
          onViewChange={setView}
          runs={runs}
          errorCount={errorCount}
          onOpenRun={openRun}
        />

        <SidebarInset className="flex flex-col overflow-hidden">
          <AppHeader
            view={view}
            profileId={profileId}
            profiles={profiles}
            onProfileChange={setProfileId}
            health={health}
            errorCount={errorCount}
            loading={loading}
            onRefresh={refresh}
            onDeploy={() => setShowDeploy(true)}
          />

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
            )}

            {view === "dashboard" && (
              <DashboardView runs={runs} dashboard={dashboard} jobs={dashboardJobs} activity={activity} />
            )}
            {view === "agents" && (
              <AgentsView runs={runs} successRate={successRate} onDeploy={() => setShowDeploy(true)} onOpenRun={openRun} />
            )}
            {view === "terminal" && (
              <TerminalPageView
                runs={runs}
                dashboard={dashboard}
                appliedJobs={dashboardJobs.filter(j => j.status === "succeeded")}
                runningCount={runningCount}
                onDeploy={() => setShowDeploy(true)}
              />
            )}
            {view === "settings" && <SettingsView health={health} />}
          </div>

          <AppFooter
            runningCount={runningCount}
            inFlightJobs={inFlightJobs}
            postedCount={postedCount}
            errorCount={errorCount}
          />
        </SidebarInset>
      </div>

      {showDeploy && (
        <DeployModal onClose={() => setShowDeploy(false)} onDeploy={startRun} />
      )}
      {activeRun && (
        <LiveRunPanel
          run={activeRun}
          onClose={() => { setActiveRun(null); refresh(); }}
          onLog={addLog}
        />
      )}
    </SidebarProvider>
  );
}
