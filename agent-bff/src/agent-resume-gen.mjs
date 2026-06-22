import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.mjs";
import { formatUsd } from "../../core-backend/src/pricing.mjs";
import { buildJdSkillProfileText } from "../../core-backend/src/resume-match.mjs";

function emitResumeGenUsage(emit, result, jobIndex) {
  const u = result?.usage;
  if (!u || !emit) return;
  const costUsd = Number(u.costUsd ?? u.cost ?? 0);
  emit({
    type: "usage",
    source: "resumeGen",
    jobIndex,
    model: result.model || u.model,
    inputTokens: Number(u.inputTokens ?? 0),
    cachedTokens: Number(u.cachedTokens ?? 0),
    outputTokens: Number(u.outputTokens ?? 0),
    totalTokens: Number(u.totalTokens ?? 0),
    costUsd,
    priced: true,
    costLabel: formatUsd(costUsd),
    reused: !!result.reused,
  });
}

/**
 * Generate (or reuse) a per-job AI resume via Athens-server, then write it to
 * destFilePath for codex upload. Runs in parallel with browser navigation.
 */
export async function ensureAgentJobResumeFile({ applierName, job, destFilePath, emit, jobIndex, model }) {
  const jobId = job?.id != null ? String(job.id) : "";
  const jobDescription =
    String(job?.description || "").trim() ||
    buildJdSkillProfileText(job) ||
    [job?.title, job?.company].filter(Boolean).join(" at ");

  if (!applierName) throw new Error("applierName is required for AI resume generation");
  if (!jobId) throw new Error("job id is required for AI resume generation");
  if (!jobDescription) throw new Error("job description is required for AI resume generation");

  emit?.({
    type: "step",
    level: "info",
    title: "AI resume",
    detail: "Checking for an existing job-tailored resume…",
    jobIndex,
  });

  const url = `${CONFIG.athensServerUrl}/api/personal/resume-generate/for-agent-job`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, jobId, jobDescription, model }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Resume generation failed (${res.status})`);
  }

  fs.mkdirSync(path.dirname(destFilePath), { recursive: true });
  // Prefer the rendered PDF (what ATS résumé parsers expect); fall back to text only if the
  // server couldn't render a PDF.
  let isPdf = false;
  if (data.pdfBase64) {
    fs.writeFileSync(destFilePath, Buffer.from(data.pdfBase64, "base64"));
    isPdf = true;
  } else {
    const text = String(data.extractedText || "").trim();
    if (!text) throw new Error("Resume generation returned empty content");
    fs.writeFileSync(destFilePath, text, "utf8");
  }

  emitResumeGenUsage(emit, data, jobIndex);

  emit?.({
    type: "step",
    level: data.reused ? "info" : "success",
    title: data.reused ? "Reused AI resume" : "AI resume generated",
    detail: `${data.techStack || "Generated"} · ${isPdf ? "PDF" : "text"}${data.resumePdfPath ? ` · review: ${data.resumePdfPath}` : ""}`,
    jobIndex,
  });

  return {
    reused: !!data.reused,
    resumeId: data.resumeId || null,
    techStack: data.techStack || "Generated",
    filePath: destFilePath,
    fileName: path.basename(destFilePath),
    mimeType: isPdf ? "application/pdf" : "text/plain",
    reviewPath: data.resumePdfPath || null,
    usage: data.usage,
    model: data.model,
    generationId: data.generationId || null,
  };
}
