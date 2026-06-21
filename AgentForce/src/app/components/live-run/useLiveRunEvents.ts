import { useState, useEffect, useRef, useCallback } from "react";
import type { ActiveRun, LogEntry } from "../../types";
import type { RunUsage, RunDone, RunBatch, JobView, ResumeMatch, RunMeta } from "./types";

export function emptyJob(index: number, title = "", company = ""): JobView {
  return { index, title, company, steps: [], fields: [], shot: null, status: "starting", meta: {}, resumeMatch: null };
}

// Routes the SSE/replay event stream into per-job buckets so each job in a batch keeps its
// own activity timeline, fields, screenshot, status and result.
export function useLiveRunEvents(
  run: ActiveRun,
  onLog: (agentName: string, event: string, type: LogEntry["type"]) => void,
) {
  const isReview = run.mode === "review";
  const [jobs, setJobs] = useState<JobView[]>([emptyJob(0)]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [batch, setBatch] = useState<RunBatch | null>(null);
  const [usage, setUsage] = useState<RunUsage | null>(null);
  const [done, setDone] = useState<RunDone | null>(null);
  const [paused, setPaused] = useState<{ reason: string; jobIndex?: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const currentRef = useRef(0);
  const logRef = useRef(onLog);
  logRef.current = onLog;

  const patchJob = useCallback((idx: number, fn: (j: JobView) => JobView) => {
    setJobs(prev => {
      const next = [...prev];
      while (next.length <= idx) next.push(emptyJob(next.length));
      next[idx] = fn(next[idx]);
      return next;
    });
  }, []);

  const handleEvent = useCallback((e: Record<string, unknown>) => {
    const cur = currentRef.current;
    switch (e.type) {
      case "batch":
        setBatch({ total: e.total as number, source: e.source as string });
        break;
      case "job": {
        const idx = e.index as number;
        currentRef.current = idx;
        setCurrentIndex(idx);
        patchJob(idx, () => emptyJob(idx, e.title as string, e.company as string));
        break;
      }
      case "step": {
        const step = { seq: e.seq as number, level: e.level as string, title: e.title as string, detail: e.detail as string | undefined };
        patchJob(cur, j => ({ ...j, steps: [...j.steps, step] }));
        const level = e.level as string;
        const t = (level === "error" ? "error" : level === "warn" ? "warn" : level === "success" ? "success" : "info") as LogEntry["type"];
        if (!isReview) logRef.current(run.agentName, `${e.title}${e.detail ? " — " + e.detail : ""}`, t);
        break;
      }
      case "field":
        patchJob(cur, j => ({ ...j, fields: [...j.fields.filter(x => x.label !== e.label), { label: e.label as string, value: e.value as string, source: e.source as string }] }));
        break;
      case "screenshot": {
        const fileName = e.filePath ? String(e.filePath).split("/").pop() : null;
        const src = (e.dataUrl as string) || (fileName ? `/api/runs/${run.runId}/screenshots/${fileName}` : null);
        if (src) patchJob(cur, j => ({ ...j, shot: { label: e.label as string, dataUrl: src } }));
        break;
      }
      case "status":
        patchJob(cur, j => ({ ...j, status: e.phase as string }));
        setPaused(null); // any new activity (incl. resume) clears the handoff banner
        break;
      case "paused": {
        const idx = (e.jobIndex as number | undefined) ?? cur;
        const reason = (e.reason as string) || "A human must complete a step in the browser.";
        setPaused({ reason, jobIndex: idx });
        patchJob(idx, j => ({ ...j, status: "paused" }));
        if (!isReview) logRef.current(run.agentName, `Paused for human: ${reason}`, "warn");
        break;
      }
      case "meta":
        patchJob(cur, j => ({ ...j, meta: { ...j.meta, ...(e as RunMeta) } }));
        break;
      case "usage":
        setUsage({
          model: e.model as string | undefined,
          inputTokens: e.inputTokens as number,
          cachedTokens: e.cachedTokens as number,
          outputTokens: e.outputTokens as number,
          totalTokens: e.totalTokens as number,
          costUsd: e.costUsd as number,
          costLabel: e.costLabel as string | undefined,
        });
        break;
      case "resumeMatch": {
        const idx = (e.jobIndex as number | undefined) ?? cur;
        patchJob(idx, j => ({ ...j, resumeMatch: e as unknown as ResumeMatch }));
        break;
      }
      case "jobDone": {
        const idx = e.jobIndex as number;
        const result = e.result as string;
        patchJob(idx, j => ({ ...j, result, status: result }));
        const lvl = (result === "submitted" ? "success" : (result === "error" || result === "needs_correction") ? "error" : "info") as LogEntry["type"];
        if (!isReview) logRef.current(run.agentName, `Job ${idx + 1}: ${result}`, lvl);
        break;
      }
      case "done":
        setDone(e as unknown as RunDone);
        if (e.usage) setUsage(e.usage as RunUsage);
        break;
    }
  }, [isReview, run.agentName, run.runId, patchJob]);

  useEffect(() => {
    if (isReview) {
      setConnected(true);
      fetch(`/api/runs/${run.runId}/events`)
        .then(r => r.json())
        .then(data => { for (const e of data.events || []) handleEvent(e); })
        .catch(() => setDone({ result: "error", message: "Could not load run." }));
      return;
    }
    const es = new EventSource(`/api/stream/${run.runId}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      let e: Record<string, unknown>;
      try { e = JSON.parse(ev.data); } catch { return; }
      handleEvent(e);
      if (e.type === "done") es.close();
    };
    return () => es.close();
  }, [run.runId, isReview, handleEvent]);

  return { isReview, jobs, currentIndex, batch, usage, done, paused, connected };
}
