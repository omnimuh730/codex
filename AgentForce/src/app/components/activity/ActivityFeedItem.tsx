import type { ActivityEntry } from "../../hooks/use-dashboard";
import { mono } from "../../lib/constants";
import { logStyle, activityIcon } from "../../lib/status-styles";

export function ActivityFeedItem({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex gap-3 px-5 py-3 hover:bg-secondary/40 transition-colors">
      {activityIcon(entry.type)}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`${mono} text-xs text-muted-foreground`}>{entry.time}</span>
          <span className="text-xs font-semibold text-primary/80">{entry.agentName}</span>
        </div>
        <p className={`text-xs mt-0.5 leading-snug ${logStyle(entry.type)}`}>{entry.event}</p>
      </div>
    </div>
  );
}
