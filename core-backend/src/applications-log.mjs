// Read the auto-apply applications audit log (JSONL) for activity feeds and status stats.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProfileById } from "./resumes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG = path.resolve(__dirname, "..", "..", "auto-apply", "logs", "applications.jsonl");

function logTypeForStatus(status) {
  if (status === "submitted" || status === "submitted_unconfirmed") return "success";
  if (status === "error" || status === "stopped_captcha") return "error";
  if (status === "review_pending" || status === "flagged") return "warn";
  return "info";
}

function formatEvent(row) {
  const role = row.role || "role";
  const company = row.company || "company";
  const status = row.status || "unknown";
  if (status === "submitted" || status === "submitted_unconfirmed") {
    return `Submitted — ${role} @ ${company}`;
  }
  if (status === "review_pending") return `Stopped at review — ${role} @ ${company}`;
  if (status === "error") return `Failed — ${role} @ ${company}`;
  return `${status} — ${role} @ ${company}`;
}

function parseTs(ts) {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch {
    return "—";
  }
}

function readLogLines(logPath = DEFAULT_LOG, maxLines = 500) {
  if (!fs.existsSync(logPath)) return [];
  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  return lines.slice(-maxLines);
}

export function countByStatus({ logPath = DEFAULT_LOG, profileName, maxLines = 500 } = {}) {
  const counts = {
    submitted: 0,
    submitted_unconfirmed: 0,
    review_pending: 0,
    error: 0,
    inRun: 0,
  };
  for (const line of readLogLines(logPath, maxLines)) {
    try {
      const row = JSON.parse(line);
      if (profileName && row.profile && row.profile !== profileName) continue;
      const s = row.status || "";
      if (s in counts) counts[s]++;
      else if (s === "stopped_captcha" || s === "flagged") counts.error++;
    } catch {}
  }
  return counts;
}

export function listFailedAttempts({ logPath = DEFAULT_LOG, profileName, limit = 20 } = {}) {
  const rows = [];
  for (const line of readLogLines(logPath, 500).reverse()) {
    try {
      const row = JSON.parse(line);
      if (profileName && row.profile && row.profile !== profileName) continue;
      const status = row.status || "";
      if (status !== "error" && status !== "stopped_captcha" && status !== "flagged") continue;
      rows.push({
        id: `fail_${parseTs(row.ts)}_${rows.length}`,
        title: row.role || "(unknown role)",
        company: row.company || "",
        source: "—",
        url: row.url || "",
        postedAgo: "",
        appliedDate: row.ts || null,
        applied: false,
        status: "failed",
        agentName: row.profile || "Agent",
        matchPercent: null,
      });
      if (rows.length >= limit) break;
    } catch {}
  }
  return rows;
}

export async function listActivityEntries({
  logPath = DEFAULT_LOG,
  limit = 50,
  profileId,
  profileName,
} = {}) {
  let nameFilter = profileName || "";
  if (profileId && !nameFilter) {
    const profile = await getProfileById(profileId);
    nameFilter = profile?.fullName || profile?.accountName || "";
  }

  const rows = [];
  for (const line of readLogLines(logPath, 500).reverse()) {
    try {
      const row = JSON.parse(line);
      if (nameFilter && row.profile && row.profile !== nameFilter) continue;
      const status = row.status || "unknown";
      rows.push({
        id: `log_${parseTs(row.ts)}_${rows.length}`,
        ts: row.ts,
        time: formatTime(row.ts),
        agentName: row.source === "agentforce" ? (row.profile || "Agent") : "auto-apply",
        profile: row.profile || "",
        company: row.company || "",
        role: row.role || "",
        status,
        event: formatEvent(row),
        type: logTypeForStatus(status),
        url: row.url || "",
      });
      if (rows.length >= limit) break;
    } catch {}
  }
  return rows;
}
