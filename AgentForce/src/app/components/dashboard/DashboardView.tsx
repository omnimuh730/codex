import { Zap, FileText, TrendingUp, CalendarCheck } from "lucide-react";
import type { ActivityEntry, DashboardData, JobRow } from "../../hooks/use-dashboard";
import type { RunSummary } from "../../hooks/use-dashboard";
import { KpiCard } from "./KpiCard";
import { ApplicationsChart } from "./ApplicationsChart";
import { PipelineChart } from "./PipelineChart";
import { JobTable } from "../jobs/JobTable";
import { ActivityFeed } from "../activity/ActivityFeed";

export function DashboardView({
  runs,
  dashboard,
  jobs,
  activity,
}: {
  runs: RunSummary[];
  dashboard: DashboardData | null;
  jobs: JobRow[];
  activity: ActivityEntry[];
}) {
  const runningCount = runs.filter(r => r.status === "running").length;
  const pipeline = dashboard?.runPipeline;
  const chartData = dashboard?.submissions7d?.length ? dashboard.submissions7d : (dashboard?.applications7d ?? []);
  const pipelineChart = pipeline ? [
    { stage: "In progress", count: pipeline.inProgress },
    { stage: "Succeeded", count: pipeline.succeeded },
    { stage: "Failed", count: pipeline.failed },
    { stage: "Scheduled", count: pipeline.scheduled },
    { stage: "Review", count: pipeline.review },
  ] : [];

  const succeededWeek = pipeline?.succeeded ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Zap} label="Active Runs" value={`${runningCount}`} sub={`${runs.length} total agents`} color="text-primary" />
        <KpiCard icon={FileText} label="In Progress" value={`${pipeline?.inProgress ?? 0}`} sub="jobs being applied" color="text-amber-600" />
        <KpiCard icon={TrendingUp} label="Succeeded Today" value={`${dashboard?.succeededToday ?? 0}`} sub={`${succeededWeek} total submitted`} color="text-green-600" />
        <KpiCard icon={CalendarCheck} label="Scheduled" value={`${pipeline?.scheduled ?? 0}`} sub={`${dashboard?.posted ?? 0} posted in queue`} color="text-blue-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <ApplicationsChart data={chartData} applied7d={succeededWeek} />
        <PipelineChart data={pipelineChart} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><JobTable jobs={jobs} /></div>
        <div><ActivityFeed log={activity} /></div>
      </div>
    </>
  );
}
