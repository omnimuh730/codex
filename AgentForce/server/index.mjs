// AgentForce backend: deploy requests, MongoDB profiles, OpenAI models, SSE streaming.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { CONFIG, maskKey, PATHS } from "./env.mjs";
import { runBatchCodex } from "./codex-apply.mjs";
import { ensureDeepSeekProxy } from "./proxy-control.mjs";
import { resumeRun } from "./human-handoff.mjs";

// codex-rs owns the agentic loop now; only this tiny outcome check remains here.
const isSubmissionSuccess = (result) => result === "submitted";
import { listProfiles, getProfileById, getProfileResumes } from "../../core-backend/src/resumes.mjs";
import { listOpenAiModels, DEEPSEEK_MODELS, isDeepSeekModel } from "../../core-backend/src/models.mjs";
import { listPostedJobs, listAppliedJobs, postedSourceCounts, markJobApplied, dashboardStats } from "../../core-backend/src/jobs.mjs";
import { countByStatus, listActivityEntries, listFailedAttempts } from "../../core-backend/src/applications-log.mjs";
import {
  generateRunId,
  createRun,
  appendRunEvent,
  updateRun,
  updateRunJob,
  listRuns,
  getRun,
  listRunEvents,
  markInterruptedRuns,
  countRunningJobs,
  activityFromRunEvents,
  findScreenshotPath,
  listDashboardJobs,
  dashboardRunStats,
} from "../../core-backend/src/agent-runs.mjs";
import { JobSource } from "../../core-backend/src/job-sources.mjs";
import { getDb } from "../../core-backend/src/db.mjs";
import { listScheduledJobs } from "../../core-backend/src/jobs.mjs";

/** Live SSE cache for in-flight runs only (subscribers + seq). */
const liveRuns = new Map();

function logPersistErr(label, err) {
  console.error(`[agent-runs] ${label}:`, err?.message || err);
}


function makeLiveRun({ runId, agentName, url, profileId, profileName, model, resumeStack, source, jobCount, autoSubmit, startIndex, endIndex }) {
  const run = {
    id: runId, agentName, url, profileId, profileName, model, resumeStack, source, jobCount,
    autoSubmit, startIndex, endIndex,
    events: [], seq: 0, subscribers: new Set(), status: "running", result: null,
    startedAt: Date.now(), finishedAt: null, jobResults: {},
  };
  liveRuns.set(runId, run);
  return run;
}

function persistRunUpdates(run, e) {
  if (e.type === "status" && e.phase) {
    updateRun(run.id, { status: e.phase === "error" ? "error" : "running" }).catch(err => logPersistErr("updateRun status", err));
  }
  if (e.type === "jobDone") {
    const idx = e.jobIndex;
    const patch = { result: e.result, finishedAt: new Date() };
    if (isSubmissionSuccess(e.result)) patch.appliedInDb = true;
    updateRunJob(run.id, idx, patch).catch(err => logPersistErr("updateRunJob", err));
    const submitted = Object.values(run.jobResults).filter(r => r === "submitted" || r === "submitted_unconfirmed").length;
    updateRun(run.id, { submitted }).catch(err => logPersistErr("updateRun submitted", err));
  }
  if (e.type === "resumeMatch") {
    const idx = e.jobIndex ?? e.index;
    if (idx != null) {
      updateRunJob(run.id, idx, {
        resumeStack: e.resumeStack || null,
        matchPercent: e.bestResume?.scorePercent ?? null,
        skillProfile: (e.skillProfile || "").slice(0, 500) || null,
        jobSkills: e.jobSkills || [],
      }).catch(err => logPersistErr("updateRunJob resumeMatch", err));
    }
  }
  if (e.type === "usage" && e.costUsd != null) {
    updateRun(run.id, {
      usage: {
        model: e.model,
        inputTokens: e.inputTokens,
        cachedTokens: e.cachedTokens,
        outputTokens: e.outputTokens,
        totalTokens: e.totalTokens,
        costUsd: e.costUsd,
        costLabel: e.costLabel,
      },
    }).catch(err => logPersistErr("updateRun usage", err));
  }
  if (e.type === "paused") {
    updateRun(run.id, { status: "paused" }).catch(err => logPersistErr("updateRun paused", err));
  }
  if (e.type === "done") {
    const submitted = e.submitted ?? Object.values(run.jobResults).filter(r => r === "submitted" || r === "submitted_unconfirmed").length;
    const status = e.result === "error" ? "error" : "done";
    updateRun(run.id, {
      status,
      result: e.result,
      finishedAt: new Date(),
      submitted,
      usage: e.usage || undefined,
    }).catch(err => logPersistErr("updateRun done", err));
    setTimeout(() => liveRuns.delete(run.id), 60_000);
  }
}

function emitTo(run, event) {
  const e = { seq: ++run.seq, ts: Date.now(), ...event };
  run.events.push(e);
  if (run.events.length > 1000) run.events.shift();
  if (event.type === "status") run.status = event.phase;
  if (event.type === "jobDone") run.jobResults[event.jobIndex] = event.result;
  if (event.type === "paused") run.status = "paused";
  if (event.type === "done") {
    run.status = "done";
    run.result = event.result;
    run.finishedAt = Date.now();
  }

  appendRunEvent(run.id, e, { seq: e.seq }).catch(err => logPersistErr("appendRunEvent", err));
  persistRunUpdates(run, e);

  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of run.subscribers) { try { res.write(line); } catch {} }
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

function parseTs(ts) {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

// Pick the credential matching the chosen model's provider, preferring the
// per-profile key and falling back to the server-wide env key.
function keyForModel(profile, model) {
  return isDeepSeekModel(model)
    ? profile?.deepseekApiKey || CONFIG.deepseekApiKey
    : profile?.openaiApiKey || CONFIG.openaiApiKey;
}

async function resolveApiKey(profileId, model) {
  if (!profileId) return keyForModel(null, model);
  const profile = await getProfileById(profileId);
  return keyForModel(profile, model);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  if (pathname === "/api/health") {
    let mongoOk = false;
    try {
      await getDb();
      mongoOk = true;
    } catch {}
    return sendJSON(res, 200, {
      ok: mongoOk,
      model: CONFIG.openaiModel,
      keyPresent: !!CONFIG.openaiApiKey,
      autoSubmit: CONFIG.autoSubmit,
      mongoDb: process.env.MONGODB_DB || "AIMS_local",
      mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017",
      resumeDataPath: `${PATHS.coreBackend}/data`,
      playwrightCwd: PATHS.autoApply,
      applicationsLog: `${PATHS.autoApply}/logs/applications.jsonl`,
    });
  }

  if (pathname === "/" && req.method === "GET") {
    const uiPort = process.env.VITE_PORT || "5999";
    return sendJSON(res, 200, {
      service: "AgentForce API",
      message: "This port is the API backend only. Open the dashboard in your browser.",
      dashboard: `http://localhost:${uiPort}`,
      endpoints: [
        "GET  /api/health",
        "GET  /api/profiles",
        "GET  /api/profiles/:id",
        "GET  /api/profiles/:id/resumes",
        "GET  /api/models?profileId=…",
        "GET  /api/runs",
        "GET  /api/runs/:runId",
        "GET  /api/runs/:runId/events",
        "GET  /api/runs/:runId/screenshots/:file",
        "GET  /api/dashboard",
        "GET  /api/activity",
        "POST /api/deploy",
        "GET  /api/stream/:runId  (SSE)",
      ],
    });
  }

  if (pathname === "/api/profiles" && req.method === "GET") {
    try {
      const profiles = await listProfiles();
      return sendJSON(res, 200, { profiles });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && req.method === "GET") {
    try {
      const profile = await getProfileById(profileMatch[1]);
      if (!profile) return sendJSON(res, 404, { error: "profile not found" });
      const { openaiApiKey, ...safe } = profile;
      return sendJSON(res, 200, { profile: safe });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const profileResumesMatch = pathname.match(/^\/api\/profiles\/([^/]+)\/resumes$/);
  if (profileResumesMatch && req.method === "GET") {
    try {
      const info = await getProfileResumes(profileResumesMatch[1]);
      if (!info) return sendJSON(res, 404, { error: "profile not found" });
      return sendJSON(res, 200, info);
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/models" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId");
      // OpenAI models are discovered live (needs a key); DeepSeek's fixed catalog
      // is always offered so a DeepSeek-only profile still has models to pick.
      const openaiKey = await resolveApiKey(profileId, "gpt");
      let models = [];
      if (openaiKey) {
        try { models = await listOpenAiModels(openaiKey); } catch (err) { console.warn(`OpenAI model list failed: ${err?.message || err}`); }
      }
      models = [...models, ...DEEPSEEK_MODELS.map((id) => ({ id }))];
      return sendJSON(res, 200, { models });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/job-sources" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId") || "";
      const { counts, total } = await postedSourceCounts({ applierId: profileId });
      const sources = JobSource
        .filter(s => s.type !== "Legal" && s.title !== "Other" && (counts[s.title] || 0) > 0)
        .map(s => ({ title: s.title, type: s.type, posted: counts[s.title] || 0 }))
        .sort((a, b) => b.posted - a.posted);
      return sendJSON(res, 200, { sources, total });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/jobs" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId") || "";
      const source = url.searchParams.get("source") || "";
      const appliedParam = url.searchParams.get("applied") === "true";
      const skip = parseInt(url.searchParams.get("skip") || "0", 10) || 0;
      const limit = parseInt(url.searchParams.get("limit") || "20", 10) || 20;
      const jobs = appliedParam
        ? await listAppliedJobs({ source, applierId: profileId, skip, limit })
        : await listPostedJobs({ source, applierId: profileId, skip, limit });
      let failed = [];
      if (appliedParam) {
        let profileName = "";
        if (profileId) {
          const p = await getProfileById(profileId);
          profileName = p?.fullName || p?.accountName || "";
        }
        failed = listFailedAttempts({ profileName: profileName || undefined, limit: 20 });
      }
      return sendJSON(res, 200, { jobs, applied: appliedParam, failed });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/runs" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId") || "";
      const limit = parseInt(url.searchParams.get("limit") || "50", 10) || 50;
      const runs = await listRuns({ profileId: profileId || undefined, limit });
      return sendJSON(res, 200, { runs });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const runEventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (runEventsMatch && req.method === "GET") {
    try {
      const afterSeq = parseInt(url.searchParams.get("afterSeq") || "0", 10) || 0;
      const limit = parseInt(url.searchParams.get("limit") || "2000", 10) || 2000;
      const events = await listRunEvents(runEventsMatch[1], { afterSeq, limit });
      return sendJSON(res, 200, { events });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const runScreenshotMatch = pathname.match(/^\/api\/runs\/([^/]+)\/screenshots\/([^/]+)$/);
  if (runScreenshotMatch && req.method === "GET") {
    try {
      const runId = runScreenshotMatch[1];
      const fileName = path.basename(runScreenshotMatch[2]);
      if (fileName !== runScreenshotMatch[2] || fileName.includes("..")) {
        return sendJSON(res, 400, { error: "invalid file name" });
      }
      const filePath = await findScreenshotPath(runId, fileName);
      if (!filePath || !fs.existsSync(filePath)) return sendJSON(res, 404, { error: "screenshot not found" });
      const resolved = path.resolve(filePath);
      const runsDir = path.resolve(`${PATHS.autoApply}/logs/runs`);
      if (!resolved.startsWith(runsDir)) return sendJSON(res, 403, { error: "forbidden" });
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      });
      fs.createReadStream(resolved).pipe(res);
      return;
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const runDetailMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runDetailMatch && req.method === "GET") {
    try {
      const run = await getRun(runDetailMatch[1]);
      if (!run) return sendJSON(res, 404, { error: "run not found" });
      return sendJSON(res, 200, { run });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/dashboard" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId") || "";
      let profileName = "";
      if (profileId) {
        const p = await getProfileById(profileId);
        profileName = p?.fullName || p?.accountName || "";
      }
      const byStatusFromLog = countByStatus({ profileName: profileName || undefined });
      const inFlight = await countRunningJobs(profileId || undefined);
      byStatusFromLog.inRun = inFlight;
      const stats = await dashboardStats({ applierId: profileId || undefined, byStatusFromLog });
      const runStats = await dashboardRunStats({ profileId: profileId || undefined });
      const runsList = await listRuns({ profileId: profileId || undefined, limit: 100 });
      const runJobs = await listDashboardJobs({ profileId: profileId || undefined, limit: 120 });
      const scheduledJobs = await listScheduledJobs({ applierId: profileId || undefined, limit: 50 });

      const scheduledRows = scheduledJobs.map(j => ({
        id: `sched_${j.id}`,
        title: j.title,
        company: j.company,
        source: j.source,
        url: j.url,
        agentName: null,
        status: "scheduled",
        matchPercent: null,
        appliedDate: j.scheduledDate,
        postedAgo: "",
      }));

      const pipeline = {
        inProgress: runStats.pipeline.inProgress,
        succeeded: runStats.pipeline.succeeded,
        failed: runStats.pipeline.failed,
        review: runStats.pipeline.review,
        scheduled: stats.scheduled ?? scheduledRows.length,
      };

      return sendJSON(res, 200, {
        ...stats,
        activeRuns: runsList.filter(r => r.status === "running").length,
        totalRuns: runsList.length,
        inFlightJobs: inFlight,
        runPipeline: pipeline,
        submissions7d: runStats.submissions7d,
        succeededToday: runStats.succeededToday,
        jobs: [...runJobs, ...scheduledRows],
      });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/activity" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId") || "";
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10) || 50);
      const logEntries = await listActivityEntries({ profileId: profileId || undefined, limit });
      const runEntries = await activityFromRunEvents(profileId || undefined, limit);
      const merged = [...logEntries, ...runEntries]
        .sort((a, b) => parseTs(b.ts) - parseTs(a.ts))
        .slice(0, limit);
      return sendJSON(res, 200, { activity: merged });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/jobs/posted" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId") || "";
      const source = url.searchParams.get("source") || "";
      const skip = parseInt(url.searchParams.get("skip") || "0", 10) || 0;
      const limit = parseInt(url.searchParams.get("limit") || "20", 10) || 20;
      const jobs = await listPostedJobs({ source, applierId: profileId, skip, limit });
      return sendJSON(res, 200, { jobs });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/deploy" && req.method === "POST") {
    const body = await readBody(req);
    const name = (body.name || "").trim() || "Agent";
    const autoSubmit = body.autoSubmit ?? CONFIG.autoSubmit;
    const profileId = (body.profileId || "").trim();
    const model = (body.model || "").trim() || CONFIG.openaiModel;
    const source = (body.source || "").trim();
    const directUrl = (body.url || "").trim();
    const startIndex = Math.max(0, parseInt(body.startIndex ?? 0, 10) || 0);
    const endRaw = parseInt(body.endIndex ?? startIndex + 1, 10);
    const endIndex = Number.isFinite(endRaw) ? Math.max(startIndex + 1, endRaw) : startIndex + 1;

    if (!profileId) return sendJSON(res, 400, { error: "Select an applicant profile." });
    if (!source && !/^https?:\/\//i.test(directUrl)) return sendJSON(res, 400, { error: "Select a job source (or pass a direct job URL)." });

    let profile;
    try {
      profile = await getProfileById(profileId);
    } catch (err) {
      return sendJSON(res, 500, { error: `Failed to load profile: ${err?.message || err}` });
    }
    if (!profile) return sendJSON(res, 404, { error: "Profile not found." });
    if (!profile.resumePath) {
      return sendJSON(res, 400, {
        error: `No resume PDF found in ${profile.resumeFolderUrl || "profile folder"}. Add at least one resume stack — the agent picks the best match per job from the JD.`,
      });
    }

    let jobs;
    if (source) {
      try {
        jobs = await listPostedJobs({ source, applierId: profile.accountId, skip: startIndex, limit: endIndex - startIndex, includeContent: true });
      } catch (err) {
        return sendJSON(res, 500, { error: `Failed to fetch posted jobs: ${err?.message || err}` });
      }
      if (!jobs.length) return sendJSON(res, 400, { error: `No posted ${source} jobs for ${profile.fullName} in range [${startIndex}, ${endIndex}).` });
    } else {
      jobs = [{ id: null, url: directUrl, title: directUrl, company: "", source: "Direct" }];
    }

    const apiKey = keyForModel(profile, model);
    const runId = generateRunId();

    try {
      await createRun({
        runId,
        agentName: name,
        url: jobs[0].url,
        profileId,
        applierId: profile.accountId,
        profileName: profile.fullName || profile.accountName,
        model,
        resumeStack: profile.resumeStack,
        source: source || "Direct",
        jobCount: jobs.length,
        autoSubmit,
        startIndex,
        endIndex,
        jobs,
      });
    } catch (err) {
      return sendJSON(res, 500, { error: `Failed to create run: ${err?.message || err}` });
    }

    const run = makeLiveRun({
      runId, agentName: name, url: jobs[0].url, profileId,
      profileName: profile.fullName || profile.accountName,
      model, resumeStack: profile.resumeStack, source: source || "Direct", jobCount: jobs.length,
      autoSubmit, startIndex, endIndex,
    });

    sendJSON(res, 200, {
      runId: run.id, agentName: name, source: source || "Direct",
      jobCount: jobs.length, startIndex, endIndex,
      profileName: run.profileName, model, resumeStack: profile.resumeStack, resumePath: profile.resumePath,
      jobs: jobs.map(j => ({ id: j.id, title: j.title, company: j.company, url: j.url })),
    });

    // codex-rs runs the application end-to-end. For deepseek-* models, start the
    // local Responses↔Chat proxy first and point codex at it.
    (async () => {
      const proxyUrl = isDeepSeekModel(model) ? await ensureDeepSeekProxy() : undefined;
      await runBatchCodex({
        jobs, source: source || "Direct", agentName: name, autoSubmit, profile, model, apiKey,
        applierId: profile.accountId,
        runId: run.id,
        codexPath: CONFIG.codexBin,
        proxyUrl,
        markApplied: (jobId) => markJobApplied({ jobId, applierId: profile.accountId }),
        emit: (e) => emitTo(run, e),
      });
    })().catch(err => emitTo(run, { type: "done", result: "error", message: String(err?.message || err) }));
    return;
  }

  // Human handoff: resume a run that paused for a human to complete a step
  // (login, CAPTCHA, verification) in the open browser.
  const resumeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
  if (resumeMatch && req.method === "POST") {
    const runId = resumeMatch[1];
    const body = await readBody(req);
    const note = String(body?.note || "").slice(0, 500);
    const ok = resumeRun(runId, note);
    if (!ok) return sendJSON(res, 409, { error: "run is not awaiting human action" });
    const live = liveRuns.get(runId);
    if (live) emitTo(live, { type: "status", phase: "filling", message: "Resumed by human" });
    return sendJSON(res, 200, { ok: true, runId });
  }

  const streamMatch = pathname.match(/^\/api\/stream\/(.+)$/);
  if (streamMatch && req.method === "GET") {
    const runId = streamMatch[1];
    let live = liveRuns.get(runId);
    let dbRun;
    try {
      dbRun = await getRun(runId);
    } catch {}
    if (!live && !dbRun) return sendJSON(res, 404, { error: "run not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");

    try {
      const events = await listRunEvents(runId, { afterSeq: 0, limit: 5000 });
      let maxSeq = 0;
      for (const e of events) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
        if (e.seq > maxSeq) maxSeq = e.seq;
      }
      if (live) {
        for (const e of live.events) {
          if (e.seq > maxSeq) res.write(`data: ${JSON.stringify(e)}\n\n`);
        }
        live.subscribers.add(res);
      }
    } catch (err) {
      if (live) {
        for (const e of live.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
        live.subscribers.add(res);
      }
    }

    const isLive = live && live.status === "running";
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      if (live) live.subscribers.delete(res);
    });
    if (!isLive) {
      setTimeout(() => { try { res.end(); } catch {} }, 500);
    }
    return;
  }

  sendJSON(res, 404, { error: "not found" });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${CONFIG.port} is already in use.`);
    console.error(`  Stop the other process:  lsof -ti :${CONFIG.port} | xargs kill`);
    console.error(`  Or use another port:   PORT=${CONFIG.port + 1} npm run server\n`);
    process.exit(1);
  }
  throw err;
});

markInterruptedRuns()
  .then(() => {
    server.listen(CONFIG.port, () => {
      console.log(`\n  AgentForce backend  →  http://localhost:${CONFIG.port}`);
      console.log(`  OpenAI model        →  ${CONFIG.openaiModel} (default)`);
      console.log(`  OpenAI key          →  ${maskKey(CONFIG.openaiApiKey)}`);
      console.log(`  auto-submit         →  ${CONFIG.autoSubmit}`);
      console.log(`  MongoDB             →  ${process.env.MONGODB_URI || "mongodb://localhost:27017"}/${process.env.MONGODB_DB || "AIMS_local"}`);
      console.log(`  resume data         →  ${PATHS.coreBackend}/data`);
      console.log(`  playwright cwd      →  ${PATHS.autoApply}\n`);
    });
  })
  .catch(err => {
    console.error("Failed to mark interrupted runs:", err?.message || err);
    process.exit(1);
  });
