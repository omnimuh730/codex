import { useCallback, useEffect, useRef, useState } from "react";

export interface ProfileOption {
  id: string;
  name: string;
  fullName: string;
  email: string;
}

export interface RunSummary {
  id: string;
  agentName: string;
  profileId: string;
  profileName: string;
  model: string;
  source: string;
  jobCount: number;
  status: string;
  result: string | null;
  startedAt: number;
  finishedAt: number | null;
  submitted: number;
  url: string;
}

export interface JobRow {
  id: string;
  title: string;
  company: string;
  source: string;
  url: string;
  postedAgo: string;
  appliedDate: string | null;
  status: "in_progress" | "succeeded" | "failed" | "scheduled" | "review";
  agentName?: string | null;
  matchPercent?: number | null;
  resumeStack?: string | null;
}

export interface ActivityEntry {
  id: string;
  ts: string;
  time: string;
  agentName: string;
  profile?: string;
  event: string;
  type: "info" | "success" | "warn" | "error";
  status?: string;
}

export interface DashboardData {
  posted: number;
  appliedToday: number;
  applied7d: number;
  scheduled: number;
  activeRuns: number;
  totalRuns: number;
  inFlightJobs: number;
  succeededToday: number;
  bySource: Record<string, number>;
  runPipeline: {
    inProgress: number;
    succeeded: number;
    failed: number;
    review: number;
    scheduled: number;
  };
  pipelineStages: {
    posted: number;
    scheduled: number;
    inRun: number;
    submitted: number;
    reviewPending: number;
    error: number;
  };
  applications7d: { day: string; date: string; count: number }[];
  submissions7d: { day: string; date: string; count: number }[];
  byStatus: Record<string, number>;
  jobs: JobRow[];
}

export interface HealthData {
  ok: boolean;
  model: string;
  keyPresent: boolean;
  autoSubmit: boolean;
  mongoDb: string;
  mongoUri: string;
  resumeDataPath: string;
  playwrightCwd: string;
  applicationsLog: string;
}

function qs(profileId: string | null, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (profileId) p.set("profileId", profileId);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function useDashboard() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const liveLogRef = useRef<ActivityEntry[]>([]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [healthRes, dashRes, runsRes, actRes, profRes] = await Promise.all([
        fetch("/api/health").then(r => r.json()),
        fetch(`/api/dashboard${qs(profileId)}`).then(r => r.json()),
        fetch(`/api/runs${qs(profileId)}`).then(r => r.json()),
        fetch(`/api/activity${qs(profileId, { limit: "50" })}`).then(r => r.json()),
        fetch("/api/profiles").then(r => r.json()),
      ]);

      if (dashRes.error) throw new Error(dashRes.error);
      setHealth(healthRes);
      setDashboard(dashRes);
      setRuns(runsRes.runs || []);
      const serverActivity: ActivityEntry[] = actRes.activity || [];
      const merged = [...liveLogRef.current, ...serverActivity]
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i)
        .slice(0, 50);
      setActivity(merged);
      if (profRes.profiles) setProfiles(profRes.profiles);
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const hasRunning = runs.some(r => r.status === "running");
    if (!hasRunning) return;
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [runs, refresh]);

  function prependActivity(entry: Omit<ActivityEntry, "id" | "ts"> & { id?: string; ts?: string }) {
    const full: ActivityEntry = {
      id: entry.id || `live_${Date.now()}`,
      ts: entry.ts || new Date().toISOString(),
      time: entry.time || new Date().toLocaleTimeString("en-US", { hour12: false }),
      agentName: entry.agentName,
      profile: entry.profile,
      event: entry.event,
      type: entry.type,
      status: entry.status,
    };
    liveLogRef.current = [full, ...liveLogRef.current].slice(0, 20);
    setActivity(prev => [full, ...prev.filter(e => e.id !== full.id)].slice(0, 50));
  }

  const dashboardJobs: JobRow[] = dashboard?.jobs || [];

  const successRate = (() => {
    const p = dashboard?.runPipeline;
    if (!p) return 0;
    const total = p.succeeded + p.failed + p.review;
    return total > 0 ? Math.round((p.succeeded / total) * 100) : 0;
  })();

  return {
    profileId,
    setProfileId,
    profiles,
    dashboard,
    runs,
    activity,
    dashboardJobs,
    health,
    loading,
    error,
    refresh,
    prependActivity,
    successRate,
  };
}
