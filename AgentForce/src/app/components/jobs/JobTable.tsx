import { useState } from "react";
import { Search } from "lucide-react";
import type { JobRow } from "../../hooks/use-dashboard";
import type { JobTabKey } from "../../types";
import { AppCard } from "../primitives";
import { JobTableTabs } from "./JobTableTabs";
import { JobTableRow } from "./JobTableRow";

export function JobTable({ jobs }: { jobs: JobRow[] }) {
  const [tab, setTab] = useState<JobTabKey>("in_progress");
  const [search, setSearch] = useState("");
  const tabs: { key: JobTabKey; label: string; count: number }[] = [
    { key: "in_progress", label: "In progress", count: jobs.filter(j => j.status === "in_progress").length },
    { key: "succeeded", label: "Succeeded", count: jobs.filter(j => j.status === "succeeded").length },
    { key: "failed", label: "Failed", count: jobs.filter(j => j.status === "failed").length },
    { key: "scheduled", label: "Scheduled", count: jobs.filter(j => j.status === "scheduled").length },
  ];
  const effectiveTab = jobs.some(j => j.status === tab)
    ? tab
    : (tabs.find(t => t.count > 0)?.key ?? "in_progress");

  const filtered = jobs.filter(j => {
    if (j.status !== effectiveTab) return false;
    const q = search.toLowerCase();
    if (q && !j.title.toLowerCase().includes(q) && !j.company.toLowerCase().includes(q) && !(j.agentName || "").toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <AppCard className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
        <JobTableTabs tabs={tabs} tab={effectiveTab} onTabChange={setTab} />
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs…"
            className="pl-8 pr-3 py-2 text-sm rounded-xl border border-border bg-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all w-48"
          />
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight: 360 }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-left sticky top-0 bg-white z-10 border-b border-border">
              <th className="px-5 py-3">Job</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(j => (
              <JobTableRow key={j.id} job={j} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Search size={20} className="opacity-40" />
            <p className="text-sm">No {tabs.find(t => t.key === effectiveTab)?.label.toLowerCase()} jobs</p>
          </div>
        )}
      </div>
    </AppCard>
  );
}
