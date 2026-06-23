// Apply to one job using codex-rs as the agent.
//
// codex drives `playwright-cli` itself (via its exec_command shell tool) to open
// the URL, read snapshots, fill the form, upload the resume, and submit/verify.
// This module only: builds the task prompt, runs codex, and translates codex's
// event stream into AgentForce's existing dashboard vocabulary (status/meta/step/
// field/done/usage) so the live-run UI works unchanged. No LLM call happens here.
//
// codex auto-loads `AGENTS.md` + `runtime/operating_procedure.md` from its working
// directory (auto-apply/), so the playwright-cli command vocabulary and per-URL
// loop are available to it as project context — the prompt need not repeat them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCodexAgent } from "./codex-runner.mjs";
import { isDeepSeekModel, DEEPSEEK_BASE_URL } from "../../core-backend/src/models.mjs";
import { costFromUsage, formatUsd, emptyUsage, mergeUsage, usageDelta } from "../../core-backend/src/pricing.mjs";
import {
  buildJdSkillProfileText,
  formatJdSkillProfileDisplay,
  parseSkillProfile,
  rankUploadedResumes,
} from "../../core-backend/src/resume-match.mjs";
import {
  listUserResumesWithContent,
  materializeResume,
} from "../../core-backend/src/user-resumes.mjs";
import { ensureAgentJobResumeFile } from "./agent-resume-gen.mjs";
import { PATHS } from "./config.mjs";
import { spawn } from "node:child_process";
import { awaitHumanResume, runSignal, wasManuallyPaused, wasStopped } from "./human-handoff.mjs";

/** Deterministic playwright-cli session name for a run (server + agent agree). */
export function sessionForRun(runId, agentName) {
  return `af-${String(runId || agentName || "").replace(/[^A-Za-z0-9_-]/g, "") || Date.now().toString(36)}`;
}

/** Best-effort close of a run's browser session (crash-safe teardown / Stop). */
export function closeBrowserSession(session) {
  if (!session) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const child = spawn("playwright-cli", [`-s=${session}`, "close"], { stdio: "ignore" });
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(); }, 8000);
      child.on("exit", () => { clearTimeout(t); resolve(); });
      child.on("error", () => { clearTimeout(t); resolve(); });
    } catch { resolve(); }
  });
}

const SECRET_FIELDS = ["openaiApiKey", "deepseekApiKey", "ecomagentApiKey", "gmailAppPassword", "defaultPassword"];

// Gmail OTP/verification reader (stdlib IMAP). codex runs it via its shell with
// GMAIL_ADDRESS/GMAIL_APP_PASSWORD in env to self-resolve email-code gates.
const OTP_SCRIPT = `${PATHS.codex}/mcps/gmail/otp_fetch.py`;

/** Drop credentials before the profile goes into the model prompt. */
function profileForPrompt(profile) {
  const safe = { ...profile };
  for (const f of SECRET_FIELDS) delete safe[f];
  return safe;
}

/** Map codex turn usage → AgentForce usage+cost (reuses core-backend pricing). */
export function usageToAgentForce(model, usage) {
  const cached = Number(
    usage?.cached_input_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0,
  ) || 0;
  const miss = usage?.input_tokens_details?.prompt_cache_miss_tokens;
  const u = costFromUsage(model, {
    prompt_tokens: usage?.input_tokens ?? 0,
    completion_tokens: usage?.output_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    prompt_cache_hit_tokens: cached,
    ...(miss != null && miss !== "" ? { prompt_cache_miss_tokens: miss } : {}),
    prompt_tokens_details: { cached_tokens: cached },
  });
  return { ...u, costLabel: formatUsd(u.costUsd) };
}

/** Parse the agent's trailing `RESULT: <status> — <reason>` line. Tolerates
 *  markdown/quoting the model sometimes adds, e.g. `RESULT: **submitted**` —
 *  otherwise a real submit is misread as `submitted_unconfirmed`, never gets
 *  marked applied, and the job is wrongly re-applied on the next run. */
export function parseResult(finalMessage) {
  const m = /RESULT:\s*[*_`'"]*\s*(submitted|review_pending|needs_login|skipped|paused|error)\b[*_`'"]*\s*(?:[—:-]\s*(.*))?/i.exec(
    String(finalMessage || ""),
  );
  if (!m) return { result: "submitted_unconfirmed", message: String(finalMessage || "").slice(0, 200) };
  return { result: m[1].toLowerCase(), message: (m[2] || "").trim() };
}

/** Compose the job-application task prompt fed to codex via stdin. */
export function buildApplyPrompt({ url, job, profile, resumePath, autoSubmit, session, resumeGenerating }) {
  // OTP fetcher invocation with this application's context so the LLM inside the
  // script can pick the RIGHT email (among many) and extract the code from it.
  const sh = (v) => String(v || "").replace(/"/g, "'").slice(0, 120);
  const otpCmd =
    `python3 "${OTP_SCRIPT}" --limit 10` +
    ` --company "${sh(job?.company)}" --job "${sh(job?.title)}" --to "${sh(profile?.email)}"`;
  const submitLine = autoSubmit
    ? "AUTO-SUBMIT IS ENABLED for this run — this OVERRIDES the project's default review-gate / human-approval step described in AGENTS.md. After verifying every required field is filled and valid, CLICK the real Submit button to actually submit the application. Do NOT stop at a review gate and do NOT wait for human approval."
    : "Fill every required field, then STOP at the final review screen WITHOUT clicking the real Submit (the human will approve).";
  return `You are an autonomous job-application agent. Apply to the job below on behalf of the applicant by driving a real browser with the \`playwright-cli\` tool. Run EVERY browser action through your shell (exec_command), e.g. \`playwright-cli open <url>\`, \`playwright-cli snapshot\`, \`playwright-cli fill <ref> "..."\`, \`playwright-cli click <ref>\`, \`playwright-cli upload <file>\`. The project's AGENTS.md and runtime/operating_procedure.md in this working directory define the exact command vocabulary and the per-URL loop — follow them.

HOW TO DRIVE THE FORM (use AI reasoning + plain playwright-cli verbs ONLY — no custom scripts, no hardcoded selectors): read the snapshot, then act one plain verb at a time (\`fill\` / \`select\` / \`check\` / \`click\`). For a custom combobox (React-Select etc., whose value is NOT in the input's \`.value\`): \`click\` it, \`type\` the option text, re-snapshot, \`click\` the option. KEEP CONTEXT SMALL: snapshot to a --filename FILE and \`grep\` only the fillable lines — never dump a full snapshot into the chat, and never \`cat\` it. VERIFY a value by reading ONE snapshot's accessibility tree — NEVER \`run-code\` to inspect outerHTML / React props / hidden inputs / CSS classes (that probing is the single biggest cost sink). Trust the snapshot and move on.

BROWSER ISOLATION (CRITICAL — other agents run at the same time): your browser is the dedicated playwright-cli session \`${session}\` (set via the PLAYWRIGHT_CLI_SESSION env var), so every playwright-cli command you run is already scoped to YOUR browser — use commands normally, no \`-s\` flag needed. You MUST NOT run \`playwright-cli close-all\` or \`playwright-cli kill-all\` — those close OTHER agents' browsers. SKIP any global close-all/kill-all preflight step suggested by AGENTS.md. If you ever need to reset, use \`playwright-cli close\` (it closes only your own session).

JOB URL: ${url}
JOB: ${job?.title || "(role)"}${job?.company ? ` at ${job.company}` : ""}

APPLICANT PROFILE (JSON) — the ONLY source of truth. Ignore config/profile.yaml and use this. Never invent facts; infer reasonably (e.g. years of experience from the work history). EEO / voluntary self-identification → decline / prefer not to say. Marketing / SMS consent → No.
${JSON.stringify(profileForPrompt(profile), null, 2)}

RESUME FILE (for any upload / setInputFiles): ${resumePath || "(none)"}
${resumeGenerating ? "\nNOTE: The resume file above is being generated in parallel while you navigate the form. If upload fails because the file is not found yet, wait a few seconds and retry the upload — it should appear shortly.\n" : ""}

${submitLine}

RESOLVE GATES YOURSELF — do NOT hand off to a human for these; you have what you need:
- PREFER NO ACCOUNT: if the page offers "apply without an account", "continue as guest", "apply with résumé/LinkedIn", or lets you proceed without signing up, ALWAYS take that path. Only create an account or sign in if the application genuinely cannot be submitted otherwise.
- ACCOUNT REGISTER / SIGN-IN: when required, use the applicant's email (in the profile above) and the password in the environment variable APPLICANT_PASSWORD. Type the password WITHOUT revealing it — run \`playwright-cli fill <ref> "$APPLICANT_PASSWORD"\` (the shell expands it; never print or echo the value). Use the same email+password for both register and sign-in.
- EMAIL VERIFICATION / OTP / SECURITY CODE: the applicant's Gmail is readable. After triggering the email, fetch the code yourself by running \`${otpCmd}\` — it loads the recent inbox and uses an LLM to find THIS application's verification email and extract its code, printing JSON like {"found":true,"code":"Hjf55mRQ","link":"...","via":"llm"}. The email can take 10–60s, so re-run the SAME command a few times (short waits) until "found" is true; if it stays false after ~60s, add \`--include-spam\`. Then type the \`code\` EXACTLY as returned into the field(s) (preserve case; split one char per box if there are multiple boxes) and continue. If a \`link\` is returned instead of a code, open it with playwright-cli. Do NOT pause for a human for email codes.

HUMAN HANDOFF — LAST RESORT ONLY: pause for a human ONLY if you truly cannot proceed yourself — an interactive/image CAPTCHA or bot-check you cannot solve, an SMS/phone verification (no phone access), or government-ID/document verification. Then do NOT close the browser; leave the page as-is and end with \`RESULT: paused — <precisely what the human must do, and on which screen>\`. Do NOT pause for email codes, account creation, or password entry — handle those yourself per above.

When finished, end your reply with EXACTLY one line:
RESULT: <submitted|review_pending|skipped|paused|error> — <short confirmation or reason>`;
}

/** Continuation prompt sent to codex (via thread resume) after a human handoff. */
export function buildResumePrompt({ note, autoSubmit, session }) {
  const submitLine = autoSubmit
    ? "Once the form is complete and valid, CLICK the real Submit button."
    : "Fill any remaining fields, then STOP at the review screen.";
  return `${note}

Your browser is the playwright-cli session \`${session}\` and is STILL OPEN at the page where you paused — the human has just completed the step you asked for. Do NOT run preflight, close-all, kill-all, or open a new browser (close-all/kill-all would close other agents' browsers). Take a fresh \`playwright-cli snapshot\` of the current page to see the new state, then continue the application from there. ${submitLine}

If you hit another human-only step, pause again the same way. When finished, end with EXACTLY one line:
RESULT: <submitted|review_pending|skipped|paused|error> — <short confirmation or reason>`;
}

/** Emit a usage event in the dashboard's shape (mirrors agent.mjs emitUsage). */
function emitUsage(emit, model, u) {
  emit({
    type: "usage",
    model,
    inputTokens: u.inputTokens,
    cachedTokens: u.cachedTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
    costUsd: u.costUsd,
    priced: u.priced,
    costLabel: u.costLabel,
  });
}

/**
 * Run one job application through codex. Emits dashboard events via `emit` and
 * returns { result, message, usage, threadId }.
 */
export async function runApplicationCodex({
  url,
  agentName,
  emit,
  autoSubmit,
  profile,
  model,
  apiKey,
  proxyUrl,
  codexPath,
  job,
  images,
  signal,
  runId,
  resumeGenerating = false,
}) {
  const step = (level, title, detail) => emit({ type: "step", level, title, detail });
  const deepseek = isDeepSeekModel(model);

  emit({ type: "status", phase: "starting", message: `Agent "${agentName}" booting for ${profile.fullName}` });
  emit({ type: "meta", profileName: profile.fullName, model, resumeStack: profile.resumeStack, resumePath: profile.resumePath, url, role: job?.title, company: job?.company });
  step("info", "Profile", `${profile.fullName} · resume: ${profile.resumeStack || "default"}`);
  step("info", "Engine", `codex-rs → ${deepseek ? "DeepSeek (via proxy)" : "OpenAI"} · ${model}`);

  let lastUsage = null;
  const onEvent = (e) => {
    switch (e.kind) {
      case "status":
        emit({ type: "status", phase: "planning", message: "Reasoning about the form" });
        break;
      case "reasoning":
        if (e.text) step("ai", "Thinking", e.text.slice(0, 200));
        break;
      case "command": {
        emit({ type: "status", phase: "filling", message: "Driving the browser" });
        const failed = typeof e.exitCode === "number" && e.exitCode !== 0;
        const detail = `${(e.command || "").slice(0, 200)}${e.output ? ` → ${String(e.output).replace(/\s+/g, " ").slice(0, 140)}` : ""}`;
        step(failed ? "warn" : "action", "playwright", detail);
        break;
      }
      case "message":
        if (e.text) step("ai", "Agent", e.text.slice(0, 300));
        break;
      case "tool":
        step("info", "tool", `${e.server || "mcp"}/${e.tool || ""}`);
        break;
      case "error":
        step("warn", "Error", e.message);
        break;
      case "usage":
        lastUsage = e.usage;
        break;
      default:
        break;
    }
  };

  // Dedicated playwright-cli session per agent run so concurrent agents each get
  // their OWN browser. PLAYWRIGHT_CLI_SESSION scopes EVERY playwright-cli command
  // to this session (verified), so codex needs no -s flag and can't touch another
  // agent's browser — provided it never runs the global close-all/kill-all.
  const session = sessionForRun(runId, agentName);

  // Secrets the agent uses to self-resolve gates — passed via env so they never
  // enter the model prompt. codex reads OTP emails with the Gmail creds and types
  // the account password via $APPLICANT_PASSWORD in shell commands.
  const gateEnv = {
    PLAYWRIGHT_CLI_SESSION: session,
    GMAIL_ADDRESS: profile.email || "",
    GMAIL_APP_PASSWORD: profile.gmailAppPassword || "",
    APPLICANT_PASSWORD: profile.defaultPassword || "",
    // OTP fetcher's LLM endpoint (OpenAI-compatible) — same provider/key as this
    // run, so it reads verification emails with a model instead of brittle regex.
    OTP_LLM_API_KEY: apiKey || "",
    OTP_LLM_BASE_URL: deepseek ? DEEPSEEK_BASE_URL : "https://api.openai.com/v1",
    OTP_LLM_MODEL: model || "",
  };

  // Turn loop: one codex `exec` per turn. A human handoff ends a turn with
  // `paused`; we await the human, then continue the SAME session via thread
  // resume. Usage accumulates across turns (delta per exec when resuming).
  let total = emptyUsage();
  let lastExecUsage = null;
  let threadId = null;
  let resumeNote = null;
  const finalUsage = () => ({ ...total, costLabel: formatUsd(total.costUsd) });
  const finishStopped = () => {
    const usage = finalUsage();
    emitUsage(emit, model, usage);
    const message = "Stopped by user";
    emit({ type: "done", result: "stopped", message, usage });
    return { result: "stopped", message, usage, threadId };
  };

  for (;;) {
    if (runId && wasStopped(runId)) return finishStopped();

    const resuming = resumeNote != null;
    const res = await runCodexAgent({
      codexPath,
      model,
      proxyUrl,
      apiKey,
      // OpenAI's built-in provider reads OPENAI_API_KEY; DeepSeek uses CODEX_API_KEY
      // (set by the runner) which the proxy forwards upstream. Plus the gate secrets.
      env: { ...gateEnv, ...(deepseek ? {} : { OPENAI_API_KEY: apiKey || "" }) },
      workingDir: PATHS.autoApply,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      prompt: resuming
        ? buildResumePrompt({ note: resumeNote, autoSubmit, session })
        : buildApplyPrompt({ url, job, profile, resumePath: profile.resumePath, autoSubmit, session, resumeGenerating }),
      images: resuming ? undefined : images,
      threadId: resuming ? threadId : undefined,
      onEvent,
      // Read the run's CURRENT signal each turn — Pause/Stop abort via a signal
      // that's replaced with a fresh one on Resume.
      signal: (runId && runSignal(runId)) || signal,
    });
    threadId = res.threadId || threadId;
    const raw = usageToAgentForce(model, res.usage || lastUsage || {});
    const increment = lastExecUsage ? usageDelta(lastExecUsage, raw) : raw;
    total = mergeUsage(total, increment);
    lastExecUsage = raw;
    lastUsage = null;

    // Stop is terminal and wins over a pause/error caused by the same abort.
    if (runId && wasStopped(runId)) return finishStopped();

    // Manual Pause: the user aborted this turn. Park until Resume (or Stop). The
    // browser stays open; we continue the SAME thread on resume.
    if (runId && wasManuallyPaused(runId)) {
      step("warn", "Paused by user", "Run paused — browser left open. Resume to continue.");
      emit({ type: "paused", reason: "Paused by user — resume to continue", threadId });
      resumeNote = await awaitHumanResume(runId);
      if (wasStopped(runId)) return finishStopped();
      step("info", "Resumed", String(resumeNote).slice(0, 160));
      emit({ type: "status", phase: "filling", message: "Resumed — continuing the application" });
      continue;
    }

    if (res.failure || res.exitCode !== 0) {
      const usage = finalUsage();
      emitUsage(emit, model, usage);
      const message = res.failure || `codex exited ${res.exitCode}: ${String(res.stderr || "").slice(0, 200)}`;
      emit({ type: "done", result: "error", message, usage });
      return { result: "error", message, usage, threadId };
    }

    const { result, message } = parseResult(res.finalMessage);

    // Human handoff: pause and wait for the dashboard's Resume (needs a runId).
    if (result === "paused" && runId) {
      step("warn", "Human action needed", message || "A human must complete a step in the browser");
      emit({ type: "paused", reason: message || "Human action required in the browser", threadId });
      resumeNote = await awaitHumanResume(runId);
      if (wasStopped(runId)) return finishStopped();
      step("info", "Resumed by human", String(resumeNote).slice(0, 160));
      emit({ type: "status", phase: "filling", message: "Resumed — continuing the application" });
      continue;
    }

    const usage = finalUsage();
    emitUsage(emit, model, usage);
    emit({ type: "done", result, message, usage });
    return { result, message, usage, threadId };
  }
}

export { emptyUsage };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSubmissionSuccess = (result) => result === "submitted";

function appendLog(rec) {
  try {
    const file = `${PATHS.autoApply}/logs/applications.jsonl`;
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), source: "agentforce", ...rec }) + "\n");
  } catch {}
}

/**
 * Apply to a batch of jobs one-by-one with codex, streaming the batch/job framing
 * the dashboard expects (batch → job → resumeMatch → job → jobDone → done).
 * Picks the best uploaded resume per job from MongoDB using JD skills.
 */
export async function runBatchCodex(opts) {
  const { jobs, source, agentName, emit, markApplied, controller = null, codexPath, proxyUrl } = opts;
  const session = sessionForRun(opts.runId, agentName);
  try {
    return await runBatchCodexInner(opts, { session });
  } finally {
    // Crash-safe teardown: whenever the batch ends (done / error / stop), make sure
    // this run's browser is closed so a failed agent never leaks a Chrome window.
    // (A paused run never reaches here — it's parked awaiting Resume.)
    await closeBrowserSession(session);
  }
}

async function runBatchCodexInner(opts, { session }) {
  const { jobs, source, agentName, emit, markApplied, controller = null, codexPath, proxyUrl } = opts;
  // Provider selection: codex (default) or claude-code. Both runApplication*
  // implementations share this signature, so the loop below is provider-agnostic.
  const runApplication = opts.runApplication || runApplicationCodex;
  const { claudeBin, claudeCwd } = opts;
  const check = () => controller?.checkpoint?.();
  emit({ type: "batch", total: jobs.length, source, agentName, generateResumeByAi: !!opts.generateResumeByAi });
  let submitted = 0;
  let skipped = 0;
  const results = [];

  const uploadedResumes = opts.generateResumeByAi
    ? []
    : await listUserResumesWithContent(opts.profile.accountId, {
        ownerName: opts.profile.fullName || opts.profile.accountName,
      });
  const resumeTempDir = path.join(os.tmpdir(), "nextoffer-runs", String(opts.runId || "batch"));
  const applierName = opts.profile.fullName || opts.profile.accountName;

  for (let i = 0; i < jobs.length; i++) {
    try {
      await check();
    } catch {
      emit({ type: "done", result: "stopped", message: `Stopped after ${i}/${jobs.length} jobs`, submitted, total: jobs.length, results });
      return;
    }

    const job = jobs[i];
    emit({ type: "job", index: i, total: jobs.length, jobId: job.id, title: job.title, company: job.company, url: job.url, source: job.source });

    const jobEmit = (e) => {
      if (e.type === "done") return emit({ ...e, type: "jobDone", jobIndex: i });
      if (e.type === "paused" || e.type === "usage" || e.type === "step") return emit({ ...e, jobIndex: i });
      return emit(e);
    };

    let jobProfile = opts.profile;

    if (opts.generateResumeByAi) {
      const destDir = path.join(resumeTempDir, String(i));
      // The ATS shows the uploaded file's name, so name it after the applicant —
      // e.g. "Eli Taylor.pdf" — not an opaque "resume-<jobid>". The generator
      // renders a real PDF; the filename matches that.
      const resumeBaseName = String(applierName || "Resume").replace(/[^\w.\-()+ ]+/g, "_").trim() || "Resume";
      const destFilePath = path.join(destDir, `${resumeBaseName}.pdf`);
      fs.mkdirSync(destDir, { recursive: true });

      const jdText = buildJdSkillProfileText(job);
      emit({
        type: "resumeMatch",
        jobIndex: i,
        jobTitle: job.title,
        jobCompany: job.company,
        jobDescription: (job.description || "").slice(0, 3000),
        jobSkills: job.skills || [],
        skillProfile: formatJdSkillProfileDisplay(parseSkillProfile(jdText)) || jdText || null,
        bestResume: { name: "AI Generated (per job)", scorePercent: 100 },
        topResumes: [{ name: "AI Generated (per job)", scorePercent: 100 }],
        resumeStack: "AI Generated",
        aiGenerated: true,
      });

      jobProfile = {
        ...opts.profile,
        resumeStack: "AI Generated",
        resumePath: destFilePath,
        resumeMimeType: "application/pdf",
        resumeFileName: path.basename(destFilePath),
      };

      const resumeGenPromise = ensureAgentJobResumeFile({
        applierName,
        job,
        destFilePath,
        emit: jobEmit,
        jobIndex: i,
      }).then((resumeResult) => {
        jobProfile = {
          ...jobProfile,
          resumeStack: resumeResult.techStack || "AI Generated",
          resumeId: resumeResult.resumeId,
        };
        emit({
          type: "resumeMatch",
          jobIndex: i,
          jobTitle: job.title,
          jobCompany: job.company,
          bestResume: { name: resumeResult.techStack || "AI Generated", scorePercent: 100 },
          topResumes: [{ name: resumeResult.techStack || "AI Generated", scorePercent: 100 }],
          resumeStack: resumeResult.techStack || "AI Generated",
          aiGenerated: true,
          reused: resumeResult.reused,
        });
        return resumeResult;
      });

      let r;
      try {
        const [applyResult] = await Promise.all([
          runApplication({
            url: job.url,
            agentName,
            emit: jobEmit,
            autoSubmit: opts.autoSubmit,
            profile: jobProfile,
            model: opts.model,
            apiKey: opts.apiKey,
            proxyUrl,
            codexPath,
            claudeBin,
            claudeCwd,
            job,
            runId: opts.runId,
            signal: controller?.signal,
            resumeGenerating: true,
          }),
          resumeGenPromise,
        ]);
        r = applyResult;
      } catch (e) {
        jobEmit({ type: "done", result: "error", message: String(e?.message || e).slice(0, 200) });
        r = { result: "error" };
      }

      results.push({ jobId: job.id, title: job.title, result: r.result });
      appendLog({ url: job.url, company: job.company, role: job.title, status: r.result, profile: opts.profile.fullName, model: opts.model, usage: r.usage });

      if (isSubmissionSuccess(r.result) || r.result === "skipped") {
        if (isSubmissionSuccess(r.result)) submitted++;
        else skipped++;
        if (job.id && markApplied) {
          try {
            await markApplied(job.id);
            emit({ type: "step", level: "success", title: isSubmissionSuccess(r.result) ? "Marked applied in MongoDB" : "Skipped — marked handled", detail: job.title });
          } catch (e) {
            emit({ type: "step", level: "warn", title: "Could not update MongoDB", detail: String(e?.message || e).slice(0, 80) });
          }
        }
      }
      if (i < jobs.length - 1) await sleep(1500);
      continue;
    }

    if (uploadedResumes.length) {
      const jdText = buildJdSkillProfileText(job);
      const jdScores = parseSkillProfile(jdText);
      let ranked = rankUploadedResumes(jdText, uploadedResumes, opts.profile.resumeCatalog, 5);

      let chosenDoc;
      let chosenRank;
      if (ranked.length) {
        chosenRank = ranked[0];
        chosenDoc = uploadedResumes.find((r) => String(r._id) === chosenRank.id);
      } else {
        chosenDoc = uploadedResumes.find((r) => r.isPrimary) || uploadedResumes[0];
        chosenRank = {
          id: String(chosenDoc._id),
          techStack: chosenDoc.techStack,
          fileName: chosenDoc.fileName,
          score: 0,
        };
        ranked = [chosenRank];
      }

      const mat = await materializeResume(chosenDoc, path.join(resumeTempDir, String(i)));
      if (mat) {
        jobProfile = {
          ...opts.profile,
          resumeStack: chosenDoc.techStack || "",
          resumePath: mat.filePath,
          resumeMimeType: mat.mimeType,
          resumeFileName: mat.fileName,
          resumeId: String(chosenDoc._id),
        };
      }

      const bestName = chosenRank.techStack || chosenRank.fileName || chosenDoc?.fileName || "—";
      emit({
        type: "resumeMatch",
        jobIndex: i,
        jobTitle: job.title,
        jobCompany: job.company,
        jobDescription: (job.description || "").slice(0, 3000),
        jobSkills: job.skills || [],
        skillProfile: formatJdSkillProfileDisplay(jdScores) || jdText || null,
        bestResume: {
          name: bestName,
          scorePercent: Math.round((chosenRank.score || 0) * 100),
        },
        topResumes: ranked.map((r) => ({
          name: r.techStack || r.fileName || "—",
          scorePercent: Math.round((r.score || 0) * 100),
        })),
        resumeStack: chosenDoc?.techStack || "",
      });
    }

    let r;
    try {
      r = await runApplication({
        url: job.url,
        agentName,
        emit: jobEmit,
        autoSubmit: opts.autoSubmit,
        profile: jobProfile,
        model: opts.model,
        apiKey: opts.apiKey,
        proxyUrl,
        codexPath,
        claudeBin,
        claudeCwd,
        job,
        runId: opts.runId,
        signal: controller?.signal,
      });
    } catch (e) {
      jobEmit({ type: "done", result: "error", message: String(e?.message || e).slice(0, 200) });
      r = { result: "error" };
    }

    results.push({ jobId: job.id, title: job.title, result: r.result });
    appendLog({ url: job.url, company: job.company, role: job.title, status: r.result, profile: opts.profile.fullName, model: opts.model, usage: r.usage });

    if (isSubmissionSuccess(r.result) || r.result === "skipped") {
      if (isSubmissionSuccess(r.result)) submitted++;
      else skipped++;
      if (job.id && markApplied) {
        try {
          await markApplied(job.id);
          emit({ type: "step", level: "success", title: isSubmissionSuccess(r.result) ? "Marked applied in MongoDB" : "Skipped — marked handled", detail: job.title });
        } catch (e) {
          emit({ type: "step", level: "warn", title: "Could not update MongoDB", detail: String(e?.message || e).slice(0, 80) });
        }
      }
    }
    if (i < jobs.length - 1) await sleep(1500);
  }

  const summary = `Batch complete — ${submitted}/${jobs.length} submitted` + (skipped ? `, ${skipped} skipped` : "");
  emit({ type: "done", result: "batch_complete", message: summary, submitted, skipped, total: jobs.length, results });
}
