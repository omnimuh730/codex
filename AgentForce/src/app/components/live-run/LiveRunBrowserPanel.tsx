import { Terminal } from "lucide-react";
import type { ResumeMatch, RunField, RunMeta, RunUsage, Screenshot } from "./types";
import { LiveRunScreenshot } from "./LiveRunScreenshot";
import { LiveRunResumeMatch } from "./LiveRunResumeMatch";
import { LiveRunFieldsList } from "./LiveRunFieldsList";
import { LiveRunUsageCard } from "./LiveRunUsageCard";

export function LiveRunBrowserPanel({ shot, resumeMatch, fields, usage, meta }: {
  shot: Screenshot | null;
  resumeMatch: ResumeMatch | null;
  fields: RunField[];
  usage: RunUsage | null;
  meta: RunMeta;
}) {
  return (
    <div className="flex flex-col min-h-0">
      <div className="px-5 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
        <Terminal size={14} className="text-primary" />
        <h4 className="text-sm font-semibold text-foreground">{shot ? shot.label : "Live browser"}</h4>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <LiveRunScreenshot shot={shot} />
        {resumeMatch && <LiveRunResumeMatch resumeMatch={resumeMatch} />}
        <LiveRunFieldsList fields={fields} />
        {usage && <LiveRunUsageCard usage={usage} meta={meta} />}
      </div>
    </div>
  );
}
