import { mono } from "../../lib/constants";

export function AppFooter({
  runningCount,
  inFlightJobs,
  postedCount,
  errorCount,
}: {
  runningCount: number;
  inFlightJobs: number;
  postedCount: number;
  errorCount: number;
}) {
  return (
    <footer className="flex items-center gap-4 px-6 py-2.5 bg-white border-t border-border shrink-0" style={{ fontSize: 11 }}>
      <span className="font-semibold text-muted-foreground uppercase tracking-wider text-xs" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        AgentForce
      </span>
      <span className={`${mono} text-green-600`}>● {runningCount} running</span>
      <span className={`${mono} text-amber-600`}>● {inFlightJobs} in flight</span>
      <span className={`${mono} text-blue-600`}>● {postedCount} posted</span>
      {errorCount > 0 && <span className={`${mono} text-red-600`}>● {errorCount} error</span>}
      <span className={`ml-auto ${mono} text-muted-foreground`}>{new Date().toLocaleTimeString()}</span>
    </footer>
  );
}
