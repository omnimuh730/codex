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
import { runCodexAgent } from "./codex-runner.mjs";
import { isDeepSeekModel } from "../../core-backend/src/models.mjs";
import { costFromUsage, formatUsd, emptyUsage, mergeUsage } from "../../core-backend/src/pricing.mjs";
import { PATHS } from "./env.mjs";
import { awaitHumanResume } from "./human-handoff.mjs";

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
  const u = costFromUsage(model, {
    prompt_tokens: usage?.input_tokens ?? 0,
    completion_tokens: usage?.output_tokens ?? 0,
    total_tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    prompt_tokens_details: { cached_tokens: usage?.cached_input_tokens ?? 0 },
  });
  return { ...u, costLabel: formatUsd(u.costUsd) };
}

/** Parse codex's trailing `RESULT: <status> — <reason>` line. */
export function parseResult(finalMessage) {
  const m = /RESULT:\s*(submitted|review_pending|needs_login|skipped|paused|error)\b\s*(?:[—:-]\s*(.*))?/i.exec(
    String(finalMessage || ""),
  );
  if (!m) return { result: "submitted_unconfirmed", message: String(finalMessage || "").slice(0, 200) };
  return { result: m[1].toLowerCase(), message: (m[2] || "").trim() };
}

/** Compose the job-application task prompt fed to codex via stdin. */
export function buildApplyPrompt({ url, job, profile, resumePath, autoSubmit, session }) {
  const submitLine = autoSubmit
    ? "AUTO-SUBMIT IS ENABLED for this run — this OVERRIDES the project's default review-gate / human-approval step described in AGENTS.md. After verifying every required field is filled and valid, CLICK the real Submit button to actually submit the application. Do NOT stop at a review gate and do NOT wait for human approval."
    : "Fill every required field, then STOP at the final review screen WITHOUT clicking the real Submit (the human will approve).";
  return `You are an autonomous job-application agent. Apply to the job below on behalf of the applicant by driving a real browser with the \`playwright-cli\` tool. Run EVERY browser action through your shell (exec_command), e.g. \`playwright-cli open <url>\`, \`playwright-cli snapshot\`, \`playwright-cli fill <ref> "..."\`, \`playwright-cli click <ref>\`, \`playwright-cli upload <file>\`. The project's AGENTS.md and runtime/operating_procedure.md in this working directory define the exact command vocabulary and the per-URL loop — follow them. Re-snapshot after every action that changes the page; element refs go stale on any mutation.

BROWSER ISOLATION (CRITICAL — other agents run at the same time): your browser is the dedicated playwright-cli session \`${session}\` (set via the PLAYWRIGHT_CLI_SESSION env var), so every playwright-cli command you run is already scoped to YOUR browser — use commands normally, no \`-s\` flag needed. You MUST NOT run \`playwright-cli close-all\` or \`playwright-cli kill-all\` — those close OTHER agents' browsers. SKIP any global close-all/kill-all preflight step suggested by AGENTS.md. If you ever need to reset, use \`playwright-cli close\` (it closes only your own session).

JOB URL: ${url}
JOB: ${job?.title || "(role)"}${job?.company ? ` at ${job.company}` : ""}

APPLICANT PROFILE (JSON) — the ONLY source of truth. Ignore config/profile.yaml and use this. Never invent facts; infer reasonably (e.g. years of experience from the work history). EEO / voluntary self-identification → decline / prefer not to say. Marketing / SMS consent → No.
${JSON.stringify(profileForPrompt(profile), null, 2)}

RESUME FILE (for any upload / setInputFiles): ${resumePath || "(none)"}

${submitLine}

RESOLVE GATES YOURSELF — do NOT hand off to a human for these; you have what you need:
- PREFER NO ACCOUNT: if the page offers "apply without an account", "continue as guest", "apply with résumé/LinkedIn", or lets you proceed without signing up, ALWAYS take that path. Only create an account or sign in if the application genuinely cannot be submitted otherwise.
- ACCOUNT REGISTER / SIGN-IN: when required, use the applicant's email (in the profile above) and the password in the environment variable APPLICANT_PASSWORD. Type the password WITHOUT revealing it — run \`playwright-cli fill <ref> "$APPLICANT_PASSWORD"\` (the shell expands it; never print or echo the value). Use the same email+password for both register and sign-in.
- EMAIL VERIFICATION / OTP / SECURITY CODE: the applicant's Gmail is readable. After triggering the email, fetch the code yourself by running \`python3 "${OTP_SCRIPT}" --query "newer_than:1h"\` — it prints JSON like {"found":true,"code":"12345678","link":"..."}. The email can take 10–60s, so re-run it a few times (short waits) until "found" is true, then type the \`code\` into the field(s) (split across multiple boxes if needed) and continue. Do NOT pause for a human for email codes.

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
  const session = `af-${String(runId || agentName || "").replace(/[^A-Za-z0-9_-]/g, "") || Date.now().toString(36)}`;

  // Secrets the agent uses to self-resolve gates — passed via env so they never
  // enter the model prompt. codex reads OTP emails with the Gmail creds and types
  // the account password via $APPLICANT_PASSWORD in shell commands.
  const gateEnv = {
    PLAYWRIGHT_CLI_SESSION: session,
    GMAIL_ADDRESS: profile.email || "",
    GMAIL_APP_PASSWORD: profile.gmailAppPassword || "",
    APPLICANT_PASSWORD: profile.defaultPassword || "",
  };

  // Turn loop: one codex `exec` per turn. A human handoff ends a turn with
  // `paused`; we await the human, then continue the SAME session via thread
  // resume. Usage accumulates across turns.
  let total = emptyUsage();
  let threadId = null;
  let resumeNote = null;
  const finalUsage = () => ({ ...total, costLabel: formatUsd(total.costUsd) });

  for (;;) {
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
        : buildApplyPrompt({ url, job, profile, resumePath: profile.resumePath, autoSubmit, session }),
      images: resuming ? undefined : images,
      threadId: resuming ? threadId : undefined,
      onEvent,
      signal,
    });
    threadId = res.threadId || threadId;
    total = mergeUsage(total, usageToAgentForce(model, res.usage || lastUsage || {}));
    lastUsage = null;

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
 * the dashboard expects (batch → job → jobDone → done). codex drives the whole
 * application; there is no AI resume-match (codex works from the profile's resume;
 * per-JD stack selection can return later).
 */
export async function runBatchCodex(opts) {
  const { jobs, source, agentName, emit, markApplied, controller = null, codexPath, proxyUrl } = opts;
  const check = () => controller?.checkpoint?.();
  emit({ type: "batch", total: jobs.length, source, agentName });
  let submitted = 0;
  let skipped = 0;
  const results = [];

  for (let i = 0; i < jobs.length; i++) {
    try {
      await check();
    } catch {
      emit({ type: "done", result: "stopped", message: `Stopped after ${i}/${jobs.length} jobs`, submitted, total: jobs.length, results });
      return;
    }

    const job = jobs[i];
    emit({ type: "job", index: i, total: jobs.length, jobId: job.id, title: job.title, company: job.company, url: job.url, source: job.source });
    // Keep the SSE stream open across jobs: per-job "done" → "jobDone". Tag the
    // "paused" handoff event with the job index so the dashboard knows which job.
    const jobEmit = (e) => {
      if (e.type === "done") return emit({ ...e, type: "jobDone", jobIndex: i });
      if (e.type === "paused") return emit({ ...e, jobIndex: i });
      return emit(e);
    };

    let r;
    try {
      r = await runApplicationCodex({
        url: job.url,
        agentName,
        emit: jobEmit,
        autoSubmit: opts.autoSubmit,
        profile: opts.profile,
        model: opts.model,
        apiKey: opts.apiKey,
        proxyUrl,
        codexPath,
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
