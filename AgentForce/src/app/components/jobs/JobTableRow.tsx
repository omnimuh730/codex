import type { JobRow } from "../../hooks/use-dashboard";
import { mono } from "../../lib/constants";
import { JobBadge } from "../primitives";
import { AgentChip } from "../primitives/AgentChip";

export function JobTableRow({ job }: { job: JobRow }) {
  return (
    <tr className="border-b border-border/60 hover:bg-secondary/50 transition-colors">
      <td className="px-5 py-3.5">
        <div className="font-medium text-foreground leading-snug">{job.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{job.company}</div>
        {job.matchPercent != null && (
          <div className="text-[10px] text-violet-600 mt-0.5">{job.matchPercent}% match{job.resumeStack ? ` · ${job.resumeStack}` : ""}</div>
        )}
      </td>
      <td className="px-4 py-3.5 text-xs text-muted-foreground">{job.source}</td>
      <td className="px-4 py-3.5">
        {job.agentName ? <AgentChip name={job.agentName} /> : <span className={`${mono} text-xs text-muted-foreground`}>—</span>}
      </td>
      <td className="px-4 py-3.5"><JobBadge status={job.status} /></td>
      <td className={`px-4 py-3.5 ${mono} text-xs text-muted-foreground`}>
        {job.appliedDate ? new Date(job.appliedDate).toLocaleDateString() : "—"}
      </td>
    </tr>
  );
}
