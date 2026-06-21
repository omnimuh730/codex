import { Activity } from "lucide-react";
import type { ActivityEntry } from "../../hooks/use-dashboard";
import { AppCard } from "../primitives";
import { ActivityFeedItem } from "./ActivityFeedItem";

export function ActivityFeed({ log }: { log: ActivityEntry[] }) {
  return (
    <AppCard className="flex flex-col" style={{ maxHeight: 420 }}>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <Activity size={15} className="text-primary" />Live Feed
        </h4>
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>
      <div className="overflow-y-auto flex-1 divide-y divide-border/60">
        {log.map(entry => (
          <ActivityFeedItem key={entry.id} entry={entry} />
        ))}
      </div>
    </AppCard>
  );
}
