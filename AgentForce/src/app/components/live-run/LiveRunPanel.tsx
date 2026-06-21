import { useState } from "react";
import type { ActiveRun, LogEntry } from "../../types";
import { PHASES } from "./constants";
import { useLiveRunEvents, emptyJob } from "./useLiveRunEvents";
import type { RunDone, RunJob } from "./types";
import { LiveRunHeader } from "./LiveRunHeader";
import { LiveRunBatchProgress } from "./LiveRunBatchProgress";
import { LiveRunPhaseRail } from "./LiveRunPhaseRail";
import { LiveRunActivityFeed } from "./LiveRunActivityFeed";
import { LiveRunBrowserPanel } from "./LiveRunBrowserPanel";
import { LiveRunFooter } from "./LiveRunFooter";
import { LiveRunHandoff } from "./LiveRunHandoff";

export function LiveRunPanel({ run, onClose, onLog }: {
  run: ActiveRun;
  onClose: () => void;
  onLog: (agentName: string, event: string, type: LogEntry["type"]) => void;
}) {
  const state = useLiveRunEvents(run, onLog);
  // null = follow the live job; a number = the user pinned that job's view.
  const [pinned, setPinned] = useState<number | null>(null);

  const selectedIndex = pinned != null && state.jobs[pinned] ? pinned : state.currentIndex;
  const selJob = state.jobs[selectedIndex] ?? emptyJob(selectedIndex);
  const curJob = state.jobs[state.currentIndex] ?? emptyJob(state.currentIndex);
  const isBatch = !!state.batch && state.batch.total > 1;
  const total = state.batch?.total ?? Math.max(1, state.jobs.length);

  const job: RunJob | null = isBatch
    ? { index: selectedIndex, total, title: selJob.title, company: selJob.company }
    : null;

  // The phase rail reflects the selected job; if that job finished, show it as complete.
  const selDone: RunDone | null = state.done ?? (selJob.result ? { result: selJob.result, message: "" } : null);
  const phaseIdx = PHASES.indexOf(selJob.status);

  const selectJob = (i: number) => setPinned(i === state.currentIndex ? null : i);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card rounded-3xl border border-border w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden" style={{ boxShadow: "var(--shadow-xl)" }}>
        <LiveRunHeader
          run={run}
          isReview={state.isReview}
          done={state.done}
          connected={state.connected}
          job={job}
          meta={selJob.meta}
          onClose={onClose}
        />
        {isBatch && (
          <LiveRunBatchProgress
            batch={state.batch!}
            jobs={state.jobs}
            currentIndex={state.currentIndex}
            selectedIndex={selectedIndex}
            done={state.done}
            onSelect={selectJob}
          />
        )}
        <LiveRunPhaseRail status={selJob.status} done={selDone} phaseIdx={phaseIdx} />
        {state.paused && !state.done && <LiveRunHandoff runId={run.runId} reason={state.paused.reason} />}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
          <LiveRunActivityFeed steps={selJob.steps} isReview={state.isReview} />
          <LiveRunBrowserPanel
            shot={selJob.shot}
            resumeMatch={selJob.resumeMatch}
            fields={selJob.fields}
            usage={state.usage}
            meta={selJob.meta}
          />
        </div>
        <LiveRunFooter done={state.done} isReview={state.isReview} status={curJob.status} onClose={onClose} />
      </div>
    </div>
  );
}
