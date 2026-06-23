// Posted-job queries against the `job_market` collection.
//
// A job is "posted" (not yet applied) for a given applier when its `status` array has no
// element whose `applier` ObjectId matches. Apply link is stored as `applyLink`. The
// `source` field is the denormalized ATS name (Ashby, Greenhouse, Lever, Workday, …).
import { ObjectId } from "mongodb";
import { getDb } from "./db.mjs";

function jobsCol(db) { return db.collection("job_market"); }

function toOid(id) { try { return new ObjectId(id); } catch { return null; } }

// Filter for jobs NOT yet applied to by this applier (no status entry for them).
// When applierOid is null (fleet-wide), match all jobs with an apply link.
function postedFilter(applierOid) {
  if (!applierOid) {
    return { $or: [{ applyLink: { $regex: /^https?:\/\//i } }, { url: { $regex: /^https?:\/\//i } }] };
  }
  return { $or: [{ status: { $exists: false } }, { status: { $not: { $elemMatch: { applier: applierOid } } } }] };
}

function appliedFilter(applierOid) {
  if (!applierOid) {
    return { status: { $elemMatch: { appliedDate: { $exists: true }, scheduledDate: { $exists: false }, declinedDate: { $exists: false } } } };
  }
  return { status: { $elemMatch: appliedElemMatch(applierOid) } };
}

function appliedElemMatch(applierOid) {
  const base = { appliedDate: { $exists: true }, scheduledDate: { $exists: false }, declinedDate: { $exists: false } };
  if (applierOid) return { ...base, applier: applierOid };
  return base;
}

function buildPostedQuery({ source, applierOid }) {
  const and = [postedFilter(applierOid)];
  if (source && source !== "All") and.push({ source });
  return and.length === 1 ? and[0] : { $and: and };
}

function buildAppliedQuery({ source, applierOid }) {
  const and = [appliedFilter(applierOid)];
  if (source && source !== "All") and.push({ source });
  return and.length === 1 ? and[0] : { $and: and };
}

function pickAppliedStatus(statusArr, applierOid) {
  if (!Array.isArray(statusArr)) return null;
  for (const s of statusArr) {
    if (!s?.appliedDate || s.scheduledDate || s.declinedDate) continue;
    if (applierOid && String(s.applier) !== String(applierOid)) continue;
    return s;
  }
  return null;
}

function scheduledElemMatch(applierOid) {
  const base = { scheduledDate: { $exists: true } };
  if (applierOid) return { ...base, applier: applierOid };
  return base;
}

function pickScheduledStatus(statusArr, applierOid) {
  if (!Array.isArray(statusArr)) return null;
  for (const s of statusArr) {
    if (!s?.scheduledDate) continue;
    if (applierOid && String(s.applier) !== String(applierOid)) continue;
    return s;
  }
  return null;
}

export async function listScheduledJobs({ applierId, skip = 0, limit = 50 }) {
  const db = await getDb();
  const applierOid = toOid(applierId);
  const query = { status: { $elemMatch: scheduledElemMatch(applierOid) } };
  const docs = await jobsCol(db)
    .find(query, { projection: { description: 0 } })
    .sort({ "status.scheduledDate": -1, _id: -1 })
    .skip(Math.max(0, skip))
    .limit(Math.max(1, Math.min(200, limit)))
    .toArray();
  return docs.map(d => {
    const sched = pickScheduledStatus(d.status, applierOid);
    return {
      id: String(d._id),
      url: d.applyLink || d.url || "",
      title: d.title || "(untitled)",
      company: d.company?.name || "",
      source: d.source || "Other",
      scheduledDate: sched?.scheduledDate || null,
    };
  });
}

export async function countScheduledJobs({ applierId }) {
  const db = await getDb();
  const applierOid = toOid(applierId);
  return jobsCol(db).countDocuments({ status: { $elemMatch: scheduledElemMatch(applierOid) } });
}

function toJobSummary(d, { includeContent = false, applierOid } = {}) {
  const applied = pickAppliedStatus(d.status, applierOid);
  const base = {
    id: String(d._id),
    url: d.applyLink || d.url || "",
    title: d.title || "(untitled)",
    company: d.company?.name || "",
    source: d.source || "Other",
    postedAt: d.postedAt || d._createdAt || null,
    postedAgo: d.postedAgo || "",
    location: d.details?.location || d.location || "",
    appliedDate: applied?.appliedDate || null,
    applied: !!applied,
  };
  if (includeContent) {
    base.description = d.description || "";
    base.skills = Array.isArray(d.skills) ? d.skills : [];
  }
  return base;
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

export async function listPostedJobs({ source, applierId, skip = 0, limit = 50, includeContent = false }) {
  const db = await getDb();
  const applierOid = toOid(applierId);
  const query = buildPostedQuery({ source, applierOid });
  const docs = await jobsCol(db)
    .find(query, { projection: includeContent ? {} : { description: 0 } })
    .sort({ postedAt: -1, _id: -1 })
    .skip(Math.max(0, skip))
    .limit(Math.max(1, Math.min(500, limit)))
    .toArray();
  return docs.map(d => toJobSummary(d, { includeContent, applierOid })).filter(j => /^https?:\/\//i.test(j.url));
}

// Fetch specific jobs by id (the deploy "worker queue"), preserving the given order.
export async function listJobsByIds({ ids, applierId, includeContent = false }) {
  const db = await getDb();
  const applierOid = toOid(applierId);
  const oids = (Array.isArray(ids) ? ids : []).map(toOid).filter(Boolean);
  if (!oids.length) return [];
  const docs = await jobsCol(db)
    .find({ _id: { $in: oids } }, { projection: includeContent ? {} : { description: 0 } })
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return oids
    .map((o) => byId.get(String(o)))
    .filter(Boolean)
    .map((d) => toJobSummary(d, { includeContent, applierOid }))
    .filter((j) => /^https?:\/\//i.test(j.url));
}

export async function listAppliedJobs({ source, applierId, skip = 0, limit = 50, includeContent = false }) {
  const db = await getDb();
  const applierOid = toOid(applierId);
  const query = buildAppliedQuery({ source, applierOid });
  const docs = await jobsCol(db)
    .find(query, { projection: includeContent ? {} : { description: 0 } })
    .sort({ "status.appliedDate": -1, _id: -1 })
    .skip(Math.max(0, skip))
    .limit(Math.max(1, Math.min(500, limit)))
    .toArray();
  return docs.map(d => toJobSummary(d, { includeContent, applierOid }));
}

export async function countPostedJobs({ source, applierId }) {
  const db = await getDb();
  return jobsCol(db).countDocuments(buildPostedQuery({ source, applierOid: toOid(applierId) }));
}

export async function countAppliedJobs({ source, applierId }) {
  const db = await getDb();
  return jobsCol(db).countDocuments(buildAppliedQuery({ source, applierOid: toOid(applierId) }));
}

// Posted-job counts grouped by source, for the source picker.
export async function postedSourceCounts({ applierId }) {
  const db = await getDb();
  const rows = await jobsCol(db).aggregate([
    { $match: postedFilter(toOid(applierId)) },
    { $group: { _id: "$source", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  const counts = {};
  let total = 0;
  for (const r of rows) { counts[r._id || "Other"] = r.count; total += r.count; }
  return { counts, total };
}

// Record an application so the job stops being "posted" for this applier. Idempotent.
export async function markJobApplied({ jobId, applierId }) {
  const oid = toOid(jobId);
  const applierOid = toOid(applierId);
  if (!oid || !applierOid) return false;
  const db = await getDb();
  const existing = await jobsCol(db).findOne({ _id: oid, "status.applier": applierOid }, { projection: { _id: 1 } });
  if (existing) return false;
  await jobsCol(db).updateOne(
    { _id: oid },
    { $push: { status: { applier: applierOid, appliedDate: new Date().toISOString() } } },
  );
  return true;
}

// Dashboard aggregates: posted/applied counts, source breakdown, 7-day application series.
export async function dashboardStats({ applierId, byStatusFromLog = {} }) {
  const applierOid = toOid(applierId);
  const db = await getDb();
  const { total: posted, counts: bySource } = await postedSourceCounts({ applierId });

  const todayStart = startOfDayIso(new Date());
  const weekStart = daysAgoIso(6);

  const appliedMatch = appliedElemMatch(applierOid);
  const appliedToday = await jobsCol(db).countDocuments({
    status: { $elemMatch: { ...appliedMatch, appliedDate: { $gte: todayStart } } },
  });
  const applied7d = await jobsCol(db).countDocuments({
    status: { $elemMatch: { ...appliedMatch, appliedDate: { $gte: weekStart } } },
  });

  const scheduled = await countScheduledJobs({ applierId });

  const pipelineStages = {
    posted,
    scheduled,
    inRun: byStatusFromLog.inRun || 0,
    submitted: (byStatusFromLog.submitted || 0) + (byStatusFromLog.submitted_unconfirmed || 0),
    reviewPending: byStatusFromLog.review_pending || 0,
    error: byStatusFromLog.error || 0,
  };

  const dailyRows = await jobsCol(db).aggregate([
    { $match: { status: { $elemMatch: appliedMatch } } },
    { $unwind: "$status" },
    { $match: { "status.appliedDate": { $gte: weekStart, $exists: true } } },
    ...(applierOid ? [{ $match: { "status.applier": applierOid } }] : []),
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$status.appliedDate" } } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray();

  const dailyMap = new Map(dailyRows.map(r => [r._id, r.count]));
  const applications7d = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });
    applications7d.push({ day: dayLabel, date: key, count: dailyMap.get(key) || 0 });
  }

  return {
    posted,
    appliedToday,
    applied7d,
    scheduled,
    bySource,
    pipelineStages,
    applications7d,
    byStatus: byStatusFromLog,
  };
}
