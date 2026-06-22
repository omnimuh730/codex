// PLAN MODE — a cost-optimized alternative to the codex per-command loop.
//
// codex bills one LLM request per command (snapshot→fill→snapshot→fill…), and each
// request re-sends the whole conversation (cached), so a job costs ~$0.1–0.3 regardless
// of model — the spend is cached re-reads, where deepseek and gpt-mini price the same.
//
// Plan mode calls the LLM only ONCE PER PAGE: snapshot → plan (JSON list of steps) →
// [approve] → a DETERMINISTIC runner executes the playwright-cli commands one-by-one with
// ZERO LLM tokens → re-snapshot → re-plan. ~5 LLM calls/job instead of ~100 → ~$0.01–0.02.
// The LLM still reads the live snapshot and plans generically (no hardcoded selectors).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sessionForRun, closeBrowserSession } from "./codex-apply.mjs";
import { isDeepSeekModel, DEEPSEEK_BASE_URL } from "../../core-backend/src/models.mjs";
import { costFromUsage, formatUsd, emptyUsage, mergeUsage } from "../../core-backend/src/pricing.mjs";
import { PATHS } from "./config.mjs";
import { awaitHumanResume, wasStopped, isAwaitingHuman } from "./human-handoff.mjs";

const SECRET_FIELDS = ["openaiApiKey", "deepseekApiKey", "ecomagentApiKey", "gmailAppPassword", "defaultPassword"];
const OTP_SCRIPT = `${PATHS.codex}/mcps/gmail/otp_fetch.py`;
const MAX_PAGES = 24; // safety ceiling on plan→execute cycles per job

function profileForPrompt(profile) {
  const safe = { ...profile };
  for (const f of SECRET_FIELDS) delete safe[f];
  return safe;
}

// --- playwright-cli runner (deterministic, no LLM) ---------------------------
function pw(session, args, { timeout = 60000, env = {} } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve({ ok: code === 0, code, out, err }); } };
    try {
      const child = spawn("playwright-cli", args, {
        cwd: PATHS.autoApply,
        env: { ...process.env, PLAYWRIGHT_CLI_SESSION: session, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish(-1); }, timeout);
      child.stdout.on("data", (d) => { out += String(d); });
      child.stderr.on("data", (d) => { err += String(d); });
      child.on("exit", (c) => { clearTimeout(t); finish(c ?? 1); });
      child.on("error", () => { clearTimeout(t); finish(-1); });
    } catch { finish(-1); }
  });
}

async function snapshotPage(session, runDir, n) {
  const file = path.join(runDir, `${String(n).padStart(2, "0")}-snap.yml`);
  const r = await pw(session, ["snapshot", "--filename", file, "--depth", "14"]);
  let tree = r.out || "";
  try { if (fs.existsSync(file)) tree = fs.readFileSync(file, "utf8"); } catch {}
  // Cap what we feed the planner (one call, so a full page is fine, but bound it).
  return tree.slice(0, 14000);
}

/** Map one plan step → a playwright-cli argv. Returns null for non-browser actions. */
function stepToArgs(step, { resumePath }) {
  const ref = step.ref || step.selector;
  switch (step.action) {
    case "fill": return ["fill", ref, String(step.value ?? "")];
    case "select": return ["select", ref, String(step.value ?? "")];
    case "check": return ["check", ref];
    case "uncheck": return ["uncheck", ref];
    case "click": return ["click", ref];
    case "type": return ["type", String(step.value ?? "")];
    case "press": return ["press", String(step.value ?? "Enter")];
    case "upload": return ["upload", step.file === "resume" ? resumePath : (step.file || resumePath)];
    case "goto": return ["goto", String(step.value || "")];
    default: return null;
  }
}

// --- LLM planner -------------------------------------------------------------
function llmConfig(model, apiKey) {
  const deepseek = isDeepSeekModel(model);
  return {
    base: deepseek ? DEEPSEEK_BASE_URL : "https://api.openai.com/v1",
    key: apiKey || "",
    model: model || "deepseek-v4-flash",
  };
}

const PLAN_SCHEMA = `Return ONLY a JSON object:
{
  "summary": "<one line: what this page/section is>",
  "steps": [
    {"action":"fill|select|check|uncheck|click|type|press|upload","ref":"<exact ref from the snapshot, e.g. e23>","value":"<value if needed>","label":"<field name>","reveals":<true if this action opens a dropdown / adds rows / mutates the DOM>}
  ],
  "next": "resnapshot | submit | done | human | otp",
  "otp_refs": ["<refs of the security/verification code boxes, only when next=otp>"],
  "human_reason": "<only when next=human: the interactive captcha / id check you cannot do>",
  "flagged": [{"field":"<name>","why":"<why you could not fill it>"}]
}`;

const PLAN_RULES = `Rules:
- Use ONLY refs that appear in the snapshot. Plan ONLY actions valid on the CURRENT snapshot.
- A reveal action (custom dropdown/combobox that shows options on click, "add another") MUST be the LAST step with "reveals":true and "next":"resnapshot" — you'll see the options after we re-snapshot.
- Custom comboboxes (React-Select etc.): click the control (reveals=true) → next resnapshot → then click the option's ref.
- Native <select> → action "select" with the option label. Checkbox/radio → "check".
- Resume upload: action "upload" with "file":"resume".
- EEO / voluntary self-id → choose decline / "prefer not to say". Marketing/SMS consent → No. Never invent data; if a value isn't derivable, omit the step and add it to "flagged".
- When every required field on the page is filled: "next":"submit" (if auto-submit) including the submit button click as the last step, else "next":"done".
- Security/verification CODE field (8 boxes etc.): "next":"otp" and put the box refs in "otp_refs".
- Interactive image CAPTCHA / government-id you cannot solve: "next":"human" with "human_reason".`;

async function planPage({ model, apiKey, snapshot, profile, job, autoSubmit, resumePath, history }) {
  const cfg = llmConfig(model, apiKey);
  const sys = "You are a job-application form planner. Given an accessibility snapshot of the current page and the applicant profile, output a precise, minimal plan of browser actions to fill THIS page, as strict JSON. Do not chat.";
  const user = [
    `JOB: ${job?.title || ""}${job?.company ? " @ " + job.company : ""}`,
    `AUTO_SUBMIT: ${autoSubmit ? "yes" : "no"}`,
    `RESUME FILE: ${resumePath || "(none)"}`,
    `APPLICANT PROFILE (only source of truth):\n${JSON.stringify(profileForPrompt(profile))}`,
    history?.length ? `ALREADY DONE (don't repeat): ${history.slice(-8).join("; ")}` : "",
    `ACCESSIBILITY SNAPSHOT (refs like e12 are how you target elements):\n${snapshot}`,
    PLAN_RULES,
    PLAN_SCHEMA,
  ].filter(Boolean).join("\n\n");

  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`planner ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const plan = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const u = data.usage || {};
  const usage = costFromUsage(model, {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
    prompt_cache_hit_tokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
    prompt_cache_miss_tokens: u.prompt_cache_miss_tokens,
    prompt_tokens_details: { cached_tokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0 },
  });
  return { plan, usage };
}

// --- OTP (reuse the python fetcher) -----------------------------------------
function fetchOtp({ profile, job }) {
  return new Promise((resolve) => {
    const args = [OTP_SCRIPT, "--limit", "10", "--company", job?.company || "", "--job", job?.title || "", "--to", profile.email || ""];
    const child = spawn("python3", args, {
      env: { ...process.env, GMAIL_ADDRESS: profile.email || "", GMAIL_APP_PASSWORD: profile.gmailAppPassword || "",
        OTP_LLM_API_KEY: profile.deepseekApiKey || profile.openaiApiKey || "",
        OTP_LLM_BASE_URL: profile.deepseekApiKey ? DEEPSEEK_BASE_URL : "https://api.openai.com/v1",
        OTP_LLM_MODEL: profile.deepseekApiKey ? "deepseek-chat" : "gpt-4o-mini" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(null); }, 45000);
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("exit", () => { clearTimeout(t); try { resolve(JSON.parse(out.trim().split("\n").pop())); } catch { resolve(null); } });
    child.on("error", () => { clearTimeout(t); resolve(null); });
  });
}

// --- the loop ----------------------------------------------------------------
/**
 * Apply to one job via the plan→approve→execute→replan loop.
 * Emits dashboard events; gates on approval unless autoApprove.
 */
export async function runApplicationPlan({ url, agentName, emit, autoSubmit, autoApprove, profile, model, apiKey, job, runId }) {
  const step = (level, title, detail) => emit({ type: "step", level, title, detail });
  const session = sessionForRun(runId, agentName);
  const runDir = path.join(PATHS.autoApply, "logs", "runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  try { fs.mkdirSync(runDir, { recursive: true }); } catch {}
  let total = emptyUsage();
  const finalUsage = () => ({ ...total, costLabel: formatUsd(total.costUsd) });
  const emitUsage = () => emit({ type: "usage", model, ...finalUsage() });
  const history = [];

  const gate = async (kind, payload) => {
    if (autoApprove) return true;
    emit({ type: kind, ...payload });
    emit({ type: "paused", reason: kind === "plan" ? "Approve the plan to continue" : "Approve the commands to run" });
    const note = await awaitHumanResume(runId);
    if (wasStopped(runId) || note === "__stopped__") return false;
    return true;
  };

  const finish = (result, message) => { emitUsage(); emit({ type: "done", result, message, usage: finalUsage() }); return { result, message, usage: finalUsage() }; };

  emit({ type: "status", phase: "navigating", message: "Opening the page" });
  await pw(session, ["open", url], { timeout: 90000 });

  for (let page = 0; page < MAX_PAGES; page++) {
    if (wasStopped(runId)) return finish("stopped", "Stopped by user");

    emit({ type: "status", phase: "planning", message: `Reading & planning page ${page + 1}` });
    const snapshot = await snapshotPage(session, runDir, page);

    let plan, usage;
    try {
      ({ plan, usage } = await planPage({ model, apiKey, snapshot, profile, job, autoSubmit, resumePath: profile.resumePath, history }));
    } catch (e) {
      return finish("error", `Planner failed: ${String(e?.message || e).slice(0, 160)}`);
    }
    total = mergeUsage(total, { inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, costUsd: usage.costUsd, priced: usage.priced });
    emitUsage();
    step("ai", "Plan", `${plan.summary || "(page)"} — ${(plan.steps || []).length} steps → ${plan.next}`);

    // OTP gate: fetch the code and fill the boxes (no LLM per box).
    if (plan.next === "otp") {
      emit({ type: "status", phase: "verifying", message: "Fetching the email security code" });
      let otp = null;
      for (let tryN = 0; tryN < 5 && !otp?.found; tryN++) {
        if (tryN) await new Promise((r) => setTimeout(r, 12000));
        otp = await fetchOtp({ profile, job });
      }
      if (!otp?.found || !otp.code) return finish("error", "Could not fetch the email verification code");
      step("info", "Security code", `Fetched ${otp.code.length}-char code`);
      const chars = String(otp.code).split("");
      const refs = plan.otp_refs || [];
      for (let i = 0; i < chars.length && i < refs.length; i++) await pw(session, ["fill", refs[i], chars[i]]);
      history.push(`entered verification code into ${Math.min(chars.length, refs.length)} boxes`);
      continue; // re-snapshot → plan the submit
    }
    if (plan.next === "human") {
      step("warn", "Human action needed", plan.human_reason || "Manual step required");
      emit({ type: "paused", reason: plan.human_reason || "A human must complete a step in the browser" });
      const note = await awaitHumanResume(runId);
      if (wasStopped(runId) || note === "__stopped__") return finish("stopped", "Stopped by user");
      history.push("human completed a manual step");
      continue;
    }

    const steps = (plan.steps || []).filter((s) => stepToArgs(s, { resumePath: profile.resumePath }));
    if (!(await gate("plan", { steps, summary: plan.summary, next: plan.next, page: page + 1, flagged: plan.flagged || [] }))) {
      return finish("stopped", "Stopped by user");
    }
    const commands = steps.map((s) => ({ s, args: stepToArgs(s, { resumePath: profile.resumePath }) }));
    if (!(await gate("commands", { commands: commands.map((c) => `playwright-cli ${c.args.join(" ")}`), page: page + 1 }))) {
      return finish("stopped", "Stopped by user");
    }

    emit({ type: "status", phase: "filling", message: `Running ${commands.length} commands` });
    let revealed = false;
    for (const { s, args } of commands) {
      if (wasStopped(runId)) return finish("stopped", "Stopped by user");
      const r = await pw(session, args);
      step(r.ok ? "action" : "warn", "playwright", `${args.join(" ").slice(0, 120)}${r.ok ? "" : " → " + (r.err || r.out || "failed").slice(0, 80)}`);
      history.push(`${s.action} ${s.label || s.ref}${s.value ? "=" + String(s.value).slice(0, 30) : ""}`);
      if (s.reveals) { revealed = true; break; } // DOM mutated → refs stale → replan
    }
    await pw(session, ["run-code", "--filename=scripts/wait_stable.js"]).catch(() => {});

    if (revealed) continue;             // re-snapshot to see revealed options
    if (plan.next === "submit") {
      // confirm we actually reached a confirmation page
      const after = await snapshotPage(session, runDir, `${page}-after`);
      const ok = /thank you for applying|application (has been )?(received|submitted)|submitted/i.test(after);
      return finish(ok ? "submitted" : "submitted_unconfirmed", ok ? "Submitted — confirmation page reached" : "Submit clicked; confirmation not detected");
    }
    if (plan.next === "done") return finish("review_pending", "Form filled; stopped before submit");
    // next === resnapshot → loop again
  }
  return finish("error", `Gave up after ${MAX_PAGES} pages`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Batch wrapper mirroring runBatchCodex; closes the browser when the run ends. */
export async function runBatchPlan(opts) {
  const { jobs, source, agentName, emit, markApplied, runId, autoApprove } = opts;
  const session = sessionForRun(runId, agentName);
  try {
    emit({ type: "batch", total: jobs.length, source, agentName });
    let submitted = 0;
    const results = [];
    for (let i = 0; i < jobs.length; i++) {
      if (wasStopped(runId)) { emit({ type: "done", result: "stopped", message: `Stopped after ${i}/${jobs.length}`, submitted, total: jobs.length }); return; }
      const job = jobs[i];
      emit({ type: "job", index: i, total: jobs.length, jobId: job.id, title: job.title, company: job.company, url: job.url, source: job.source });
      const jobEmit = (e) => {
        if (e.type === "done") return emit({ ...e, type: "jobDone", jobIndex: i });
        if (e.type === "paused" || e.type === "usage") return emit({ ...e, jobIndex: i });
        return emit(e);
      };
      let r;
      try {
        r = await runApplicationPlan({ url: job.url, agentName, emit: jobEmit, autoSubmit: opts.autoSubmit, autoApprove,
          profile: opts.profile, model: opts.model, apiKey: opts.apiKey, job, runId });
      } catch (e) { jobEmit({ type: "done", result: "error", message: String(e?.message || e).slice(0, 200) }); r = { result: "error" }; }
      results.push({ jobId: job.id, title: job.title, result: r.result });
      if (r.result === "submitted") { submitted++; if (job.id && markApplied) await markApplied(job.id).catch(() => {}); }
      if (i < jobs.length - 1) await sleep(1200);
    }
    emit({ type: "done", result: "batch_complete", message: `Batch complete — ${submitted}/${jobs.length} submitted`, submitted, total: jobs.length, results });
  } finally {
    await closeBrowserSession(session);
  }
}
