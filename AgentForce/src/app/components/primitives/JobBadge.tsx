import type { JobStatus } from "../../types";
import { jobStatusStyle } from "../../lib/status-styles";

export function JobBadge({ status }: { status: JobStatus }) {
  const s = jobStatusStyle(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.badge} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
      {s.label}
    </span>
  );
}
