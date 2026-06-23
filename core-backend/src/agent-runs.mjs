// Persist AgentForce deploy runs and append-only event timelines in MongoDB.
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDb, agentRunsCollection, agentRunEventsCollection } from "./db.mjs";

let indexesReady = false;

function toOid(id) {
  if (!id) return null;
  try { return new ObjectId(id); } catch { return null; }
}

export function generateRunId() {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function ensureIndexes(db) {
  if (indexesReady) return;
  const runs = agentRunsCollection(db);
  const events = agentRunEventsCollection(db);
  await Promise.all([
    runs.createIndex({ runId: 1 }, { unique: true }),
    runs.createIndex({ profileId: 1, startedAt: -1 }),
    runs.createIndex({ status: 1, startedAt: -1 }),
    events.createIndex({ runId: 1, seq: 1 }),
    events.createIndex({ runId: 1, jobIndex: 1, seq: 1 }),
    events.createIndex({ ts: -1 }),
  ]);
  indexesReady = true;
}

function buildJobRow(job, jobIndex) {
  return {
    jobIndex,
    jobId: job.id ? toOid(job.id) : null,
    title: job.title || "(untitled)",
    company: job.company || "",
    url: job.url || "",
    source: job.source || "Other",
    result: null,
    resumeStack: null,
    matchPercent: null,
    skillProfile: null,
    jobSkills: Array.isArray(job.skills) ? job.skills : [],
    appliedInDb: false,
    finishedAt: null,
  };
}

function sanitizePayload(type, event) {
  const copy = { ...event };
  delete copy.type;
  delete copy.seq;
  delete copy.ts;
  delete copy.jobIndex;

  if (type === "screenshot") {
    const { label, filePath, runDir } = copy;
    return { label, filePath: filePath || null, runDir: runDir || null };
  }
  if (type === "resumeMatch") {
    return {
      jobIndex: copy.jobIndex,
      jobTitle: copy.jobTitle,
      jobCompany: copy.jobCompany,
      jobDescription: (copy.jobDescription || "").slice(0, 3000),
      jobSkills: copy.jobSkills || [],
      skillProfile: copy.skillProfile || null,
      bestResume: copy.bestResume || null,
      topResumes: copy.topResumes || null,
      resumeStack: copy.resumeStack || null,
      // Reference to the generated résumé so history can link to its PDF.
      generationId: copy.generationId || null,
      resumeId: copy.resumeId || null,
      aiGenerated: copy.aiGenerated || false,
    };
  }
  return copy;
}

function eventJobIndex(type, event) {
  if (event.jobIndex != null) return event.jobIndex;
  if (type === "job" || type === "jobDone") return event.index ?? event.jobIndex ?? null;
  if (type === "resumeMatch" && event.jobIndex != null) return event.jobIndex;
  return null;
}

function toRunSummary(doc) {
  const submitted = doc.submitted ?? (doc.jobs || []).filter(j =>
    j.result === "submitted" || j.result === "submitted_unconfirmed",
  ).length;
  const startedAt = doc.startedAt instanceof Date ? doc.startedAt.getTime() : doc.startedAt;
  const finishedAt = doc.finishedAt instanceof Date ? doc.finishedAt.getTime() : doc.finishedAt;
  let status = doc.status || "done";
  if (status === "done" && doc.result === "error") status = "error";
  return {
    id: doc.runId,
    agentName: doc.agentName,
    profileId: doc.profileId ? String(doc.profileId) : "",
    profileName: doc.profileName || "",
    model: doc.model || "",
    source: doc.source || "",
    jobCount: doc.jobCount || 0,
    status,
    result: doc.result || null,
    startedAt,
    finishedAt: finishedAt || null,
    submitted,
    url: doc.url || (doc.jobs?.[0]?.url) || "",
  };
}

function eventToSse(doc) {
  const ts = doc.ts instanceof Date ? doc.ts.getTime() : doc.ts;
  const base = { seq: doc.seq, ts, type: doc.type, ...(doc.payload || {}) };
  if (doc.type === "job" && doc.jobIndex != null) base.index = doc.jobIndex;
  if (doc.type === "jobDone" && doc.jobIndex != null) base.jobIndex = doc.jobIndex;
  if (doc.type === "resumeMatch" && doc.jobIndex != null) base.jobIndex = doc.jobIndex;
  return base;
}

export async function markInterruptedRuns() {
  const db = await getDb();
  await ensureIndexes(db);
  const now = new Date();
  await agentRunsCollection(db).updateMany(
    { status: "running" },
    { $set: { status: "interrupted", result: "server_restarted", finishedAt: now } },
  );
}

export async function createRun({
  runId,
  agentName,
  url,
  profileId,
  applierId,
  profileName,
  model,
  resumeStack,
  source,
  jobCount,
  autoSubmit,
  startIndex,
  endIndex,
  jobs = [],
}) {
  const db = await getDb();
  await ensureIndexes(db);
  const now = new Date();
  const doc = {
    runId,
    agentName,
    url: url || "",
    profileId: toOid(profileId),
    applierId: toOid(applierId || profileId),
    profileName: profileName || "",
    model: model || "",
    resumeStack: resumeStack || "",
    source: source || "",
    autoSubmit: !!autoSubmit,
    startIndex: startIndex ?? 0,
    endIndex: endIndex ?? jobCount,
    status: "running",
    result: null,
    jobCount: jobCount || jobs.length,
    submitted: 0,
    startedAt: now,
    finishedAt: null,
    usage: null,
    jobs: jobs.map((j, i) => buildJobRow(j, i)),
  };
  await agentRunsCollection(db).insertOne(doc);
  return doc;
}

export async function appendRunEvent(runId, event, { seq } = {}) {
  const db = await getDb();
  await ensureIndexes(db);
  const type = event.type;
  if (!type) return null;

  const jobIndex = eventJobIndex(type, event);
  const payload = sanitizePayload(type, event);
  const ts = event.ts ? new Date(event.ts) : new Date();

  let nextSeq = seq;
  if (nextSeq == null) {
    const last = await agentRunEventsCollection(db)
      .find({ runId })
      .sort({ seq: -1 })
      .limit(1)
      .toArray();
    nextSeq = (last[0]?.seq || 0) + 1;
  }

  const doc = { runId, jobIndex, seq: nextSeq, ts, type, payload };
  await agentRunEventsCollection(db).insertOne(doc);
  return { ...eventToSse(doc), seq: nextSeq, ts: ts.getTime() };
}

export async function updateRun(runId, patch) {
  const db = await getDb();
  const $set = {};
  if (patch.status != null) $set.status = patch.status;
  if (patch.result != null) $set.result = patch.result;
  if (patch.finishedAt != null) $set.finishedAt = patch.finishedAt instanceof Date ? patch.finishedAt : new Date(patch.finishedAt);
  if (patch.submitted != null) $set.submitted = patch.submitted;
  if (patch.usage != null) $set.usage = patch.usage;
  if (Object.keys($set).length === 0) return;
  await agentRunsCollection(db).updateOne({ runId }, { $set });
}

export async function updateRunJob(runId, jobIndex, patch) {
  const db = await getDb();
  const $set = {};
  for (const [k, v] of Object.entries(patch)) {
    $set[`jobs.${jobIndex}.${k}`] = v;
  }
  if (Object.keys($set).length === 0) return;
  await agentRunsCollection(db).updateOne({ runId }, { $set });
}

export async function listRuns({ profileId, limit = 50, skip = 0 } = {}) {
  const db = await getDb();
  await ensureIndexes(db);
  const query = {};
  const oid = toOid(profileId);
  if (oid) query.profileId = oid;
  const docs = await agentRunsCollection(db)
    .find(query)
    .sort({ startedAt: -1 })
    .skip(Math.max(0, skip))
    .limit(Math.max(1, Math.min(200, limit)))
    .toArray();
  return docs.map(toRunSummary);
}

export async function getRun(runId) {
  const db = await getDb();
  const doc = await agentRunsCollection(db).findOne({ runId });
  if (!doc) return null;
  return {
    ...toRunSummary(doc),
    autoSubmit: doc.autoSubmit,
    startIndex: doc.startIndex,
    endIndex: doc.endIndex,
    resumeStack: doc.resumeStack,
    usage: doc.usage,
    jobs: (doc.jobs || []).map(j => ({
      ...j,
      jobId: j.jobId ? String(j.jobId) : null,
      finishedAt: j.finishedAt instanceof Date ? j.finishedAt.toISOString() : j.finishedAt,
    })),
  };
}

export async function listRunEvents(runId, { afterSeq = 0, limit = 2000 } = {}) {
  const db = await getDb();
  const docs = await agentRunEventsCollection(db)
    .find({ runId, seq: { $gt: afterSeq } })
    .sort({ seq: 1 })
    .limit(Math.max(1, Math.min(5000, limit)))
    .toArray();
  return docs.map(eventToSse);
}

export function mapJobResultToStatus(result, runStatus) {
  if (result === "submitted" || result === "submitted_unconfirmed") return "succeeded";
  if (result === "error" || result === "stopped") return "failed";
  if (result === "review_pending") return "review";
  if (!result && (runStatus === "running" || runStatus === "paused")) return "in_progress";
  if (!result) return "in_progress";
  return "failed";
}

function runQuery(profileId) {
  const query = {};
  const oid = toOid(profileId);
  if (oid) query.profileId = oid;
  return query;
}

export async function countRunningJobs(profileId) {
  const db = await getDb();
  const query = { ...runQuery(profileId), status: "running" };
  const rows = await agentRunsCollection(db).find(query, { projection: { jobs: 1 } }).toArray();
  return rows.reduce((s, r) => s + (r.jobs || []).filter(j => !j.result).length, 0);
}

/** Flatten per-job rows from recent agent runs for the dashboard table. */
export async function listDashboardJobs({ profileId, limit = 120 } = {}) {
  const db = await getDb();
  await ensureIndexes(db);
  const docs = await agentRunsCollection(db)
    .find(runQuery(profileId), {
      projection: { runId: 1, agentName: 1, status: 1, startedAt: 1, source: 1, jobs: 1 },
    })
    .sort({ startedAt: -1 })
    .limit(40)
    .toArray();

  const rows = [];
  for (const run of docs) {
    for (const job of run.jobs || []) {
      const finishedAt = job.finishedAt instanceof Date ? job.finishedAt.toISOString() : job.finishedAt;
      const startedAt = run.startedAt instanceof Date ? run.startedAt.getTime() : run.startedAt;
      rows.push({
        id: `${run.runId}_${job.jobIndex}`,
        runId: run.runId,
        title: job.title || "(untitled)",
        company: job.company || "",
        source: job.source || run.source || "Other",
        url: job.url || "",
        agentName: run.agentName || "Agent",
        status: mapJobResultToStatus(job.result, run.status),
        matchPercent: job.matchPercent ?? null,
        resumeStack: job.resumeStack || null,
        appliedDate: finishedAt || null,
        postedAgo: "",
        dateTs: finishedAt ? Date.parse(finishedAt) : startedAt,
      });
    }
  }
  return rows
    .sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0))
    .slice(0, limit);
}

function startOfDayIso(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Run-based pipeline counts + 7-day submission series for dashboard charts. */
export async function dashboardRunStats({ profileId } = {}) {
  const db = await getDb();
  await ensureIndexes(db);
  const docs = await agentRunsCollection(db)
    .find(runQuery(profileId), { projection: { status: 1, jobs: 1 } })
    .toArray();

  const pipeline = { inProgress: 0, succeeded: 0, failed: 0, review: 0 };
  const weekStart = daysAgoIso(6);
  const todayStart = startOfDayIso(new Date());
  let succeededToday = 0;
  const dailyMap = new Map();

  for (const run of docs) {
    for (const job of run.jobs || []) {
      const st = mapJobResultToStatus(job.result, run.status);
      if (st === "in_progress") pipeline.inProgress++;
      else if (st === "succeeded") pipeline.succeeded++;
      else if (st === "failed") pipeline.failed++;
      else if (st === "review") pipeline.review++;

      if (st !== "succeeded") continue;
      const finishedAt = job.finishedAt instanceof Date ? job.finishedAt : new Date(job.finishedAt || 0);
      if (!Number.isFinite(finishedAt.getTime())) continue;
      const iso = finishedAt.toISOString();
      if (iso >= todayStart) succeededToday++;
      if (iso >= weekStart) {
        const key = iso.slice(0, 10);
        dailyMap.set(key, (dailyMap.get(key) || 0) + 1);
      }
    }
  }

  const submissions7d = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    submissions7d.push({
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: key,
      count: dailyMap.get(key) || 0,
    });
  }

  return { pipeline, succeededToday, succeeded7d: pipeline.succeeded, submissions7d };
}

export async function activityFromRunEvents(profileId, limit = 20) {
  const db = await getDb();
  await ensureIndexes(db);
  const runQuery = {};
  const oid = toOid(profileId);
  if (oid) runQuery.profileId = oid;

  const runs = await agentRunsCollection(db)
    .find(runQuery, { projection: { runId: 1, agentName: 1, profileName: 1 } })
    .sort({ startedAt: -1 })
    .limit(30)
    .toArray();
  const runIds = runs.map(r => r.runId);
  if (!runIds.length) return [];

  const runMap = new Map(runs.map(r => [r.runId, r]));
  const events = await agentRunEventsCollection(db)
    .find({ runId: { $in: runIds }, type: "step" })
    .sort({ ts: -1 })
    .limit(limit * 3)
    .toArray();

  return events.slice(0, limit).map(e => {
    const run = runMap.get(e.runId);
    const p = e.payload || {};
    const level = p.level || "info";
    return {
      id: `run_${e.runId}_${e.seq}`,
      ts: e.ts instanceof Date ? e.ts.toISOString() : String(e.ts),
      time: e.ts instanceof Date
        ? e.ts.toLocaleTimeString("en-US", { hour12: false })
        : "—",
      agentName: run?.agentName || "Agent",
      profile: run?.profileName || "",
      event: `${p.title || ""}${p.detail ? ` — ${p.detail}` : ""}`,
      type: level === "error" ? "error" : level === "warn" ? "warn" : level === "success" ? "success" : "info",
      status: level,
    };
  });
}

export async function findScreenshotPath(runId, fileName) {
  const db = await getDb();
  const safeName = path.basename(fileName);
  const doc = await agentRunEventsCollection(db).findOne({
    runId,
    type: "screenshot",
    "payload.filePath": { $regex: safeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$" },
  });
  return doc?.payload?.filePath || null;
}
