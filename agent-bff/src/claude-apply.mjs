// Apply to one job using Claude Code (the `claude` CLI) as the agent.
//
// The claude-code provider counterpart to runApplicationCodex. Claude Code drives
// the browser itself through the Playwright MCP server + Playwright CLI set up in
// the claude-code workspace. Per request, the prompt here is intentionally tiny —
// just the facts (job, profile, resume) and an order to apply. No rules/guards.
//
// Event stream + usage are translated into AgentForce's existing dashboard
// vocabulary so the live-run UI works identically to the codex path.

import { runClaudeAgent } from "./claude-runner.mjs";
import { usageToAgentForce, parseResult, runBatchCodex } from "./codex-apply.mjs";

/** Compose the (deliberately short) task prompt for Claude Code. */
export function buildClaudeApplyPrompt({ url, job, profile, resumePath, resumeGenerating }) {
  const lines = [
    "Apply to this job for me using the Playwright browser tools.",
    "",
    `Job: ${job?.title || "(role)"}${job?.company ? ` at ${job.company}` : ""}`,
    `URL: ${url}`,
    "",
    "Applicant profile (JSON):",
    JSON.stringify(profile, null, 2),
    "",
    `Resume file to upload: ${resumePath || "(none)"}`,
    "Upload EXACTLY that file path for the resume/CV field — do NOT substitute, rename, or pick any other file.",
    resumeGenerating
      ? "That resume is being generated right now in parallel, so it may not exist yet when you reach the upload step. If the upload says the file is missing, wait ~5s and retry the SAME path a few times until it appears — never fall back to a different file."
      : "",
    "",
    "Open the URL, fill the application from the profile, upload the resume, and submit.",
    "When done, end with one line: RESULT: <submitted|review_pending|skipped|error> — <short reason>",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Build the usage+cost payload from DeepSeek rates (cache HIT vs MISS split).
 *
 * We do NOT use Claude's `total_cost_usd`: the `claude` CLI prices it with
 * ANTHROPIC rates for the model name it sees, but we're on DeepSeek's endpoint,
 * so that number is wildly wrong (dollars instead of cents). DeepSeek bills cache
 * HIT tokens ~50× cheaper than MISS, so the split matters a lot.
 *
 * Anthropic usage → DeepSeek buckets:
 *   cache_read_input_tokens        → cache HIT
 *   input_tokens + cache_creation  → cache MISS  (no separate cache-write charge)
 * usageToAgentForce treats `input_tokens` as TOTAL prompt tokens and subtracts
 * `cached_input_tokens` to get the miss count, so we pass miss+hit as input_tokens.
 */
function claudeUsage(model, usage) {
  const hit = Number(usage?.cache_read_input_tokens ?? 0) || 0;
  const miss = (Number(usage?.input_tokens ?? 0) || 0) + (Number(usage?.cache_creation_input_tokens ?? 0) || 0);
  const output = Number(usage?.output_tokens ?? 0) || 0;
  return usageToAgentForce(model, {
    input_tokens: miss + hit,        // total prompt tokens; miss = this − cached
    output_tokens: output,
    cached_input_tokens: hit,
    total_tokens: miss + hit + output,
  });
}

/**
 * Run one job application through Claude Code. Same signature/return shape as
 * runApplicationCodex so the shared batch loop can call either interchangeably.
 */
export async function runApplicationClaude({
  url,
  agentName,
  emit,
  profile,
  model,
  apiKey,
  job,
  signal,
  claudeBin,
  claudeCwd,
  // Accepted-but-unused (codex-specific) so the batch loop can pass one shape:
  autoSubmit, proxyUrl, codexPath, runId, images, resumeGenerating,
}) {
  const step = (level, title, detail) => emit({ type: "step", level, title, detail });

  emit({ type: "status", phase: "starting", message: `Agent "${agentName}" booting for ${profile.fullName}` });
  emit({ type: "meta", profileName: profile.fullName, model, resumeStack: profile.resumeStack, resumePath: profile.resumePath, url, role: job?.title, company: job?.company });
  step("info", "Profile", `${profile.fullName} · resume: ${profile.resumeStack || "default"}`);
  step("info", "Engine", `claude-code → ${model}`);

  let usageRaw = null;
  const onEvent = (e) => {
    switch (e.kind) {
      case "message":
        if (e.text) step("ai", "Agent", e.text.slice(0, 300));
        break;
      case "reasoning":
        if (e.text) step("ai", "Thinking", e.text.slice(0, 200));
        break;
      case "command":
        emit({ type: "status", phase: "filling", message: "Driving the browser" });
        if (e.command) step("action", "playwright", e.command.slice(0, 200));
        else if (e.output) step("info", "result", String(e.output).slice(0, 140));
        break;
      case "tool":
        step("info", "tool", `${e.server || "claude"}/${e.tool || ""}`);
        break;
      case "error":
        step("warn", "Error", e.message);
        break;
      case "usage":
        usageRaw = e.usage || usageRaw;
        break;
      default:
        break;
    }
  };

  // Secrets passed via env (never in the prompt) so Claude Code can self-resolve
  // login/OTP gates with its shell + Playwright tools if it needs to.
  const gateEnv = {
    GMAIL_ADDRESS: profile.email || "",
    GMAIL_APP_PASSWORD: profile.gmailAppPassword || "",
    APPLICANT_PASSWORD: profile.defaultPassword || "",
  };

  const res = await runClaudeAgent({
    claudeBin,
    cwd: claudeCwd,
    model,
    apiKey,
    env: gateEnv,
    prompt: buildClaudeApplyPrompt({ url, job, profile, resumePath: profile.resumePath, resumeGenerating }),
    onEvent,
    signal,
  });

  const usage = claudeUsage(model, res.usage || usageRaw || {});
  emit({
    type: "usage", model,
    inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens, costUsd: usage.costUsd, priced: usage.priced, costLabel: usage.costLabel,
  });

  if (res.failure || res.exitCode !== 0) {
    const message = res.failure || `claude exited ${res.exitCode}: ${String(res.stderr || "").slice(0, 200)}`;
    emit({ type: "done", result: "error", message, usage });
    return { result: "error", message, usage, threadId: res.threadId };
  }

  const { result, message } = parseResult(res.finalMessage);
  emit({ type: "done", result, message, usage });
  return { result, message, usage, threadId: res.threadId };
}

/**
 * Apply to a batch of jobs with Claude Code. Reuses the shared batch loop (resume
 * matching, AI-resume generation, MongoDB marking, dashboard framing) — only the
 * per-job runner differs (runApplicationClaude instead of runApplicationCodex).
 */
export function runBatchClaude(opts) {
  return runBatchCodex({ ...opts, runApplication: runApplicationClaude });
}
