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
import { usageToAgentForce, parseResult, runBatchCodex, sessionForRun } from "./codex-apply.mjs";
import { formatUsd } from "../../core-backend/src/pricing.mjs";
import { writeRunMcpConfig } from "./mcp-session.mjs";

/** Compose the (deliberately short) task prompt for Claude Code. The detailed
 *  operating rules (drive via `playwright-cli`, snapshot-to-file + grep, etc.)
 *  live in the workspace CLAUDE.md, which is auto-loaded — keep this lean. */
export function buildClaudeApplyPrompt({ url, job, profile, resumePath, resumeGenerating, engine = "cli" }) {
  const driver = engine === "mcp"
    ? [
        "Apply to this job for me. Drive the browser with the Playwright MCP tools",
        "(mcp__playwright__* — browser_navigate, browser_snapshot, browser_click, browser_type, browser_file_upload).",
      ]
    : [
        "Apply to this job for me. Drive the browser with the `playwright-cli` terminal command",
        "(snapshot to a file and grep — do NOT use the Playwright MCP tools), per CLAUDE.md.",
      ];
  const lines = [
    ...driver,
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
    "",
    "DECIDE — is this the job's application?",
    "- A multi-step flow is NORMAL: a job-description page with an \"Apply\" / \"Apply Now\" / \"Start application\" button → CLICK it, then if asked choose \"Apply with résumé\" / \"Autofill\" (else \"Apply manually\") and fill the form. Workday/Greenhouse/iCIMS work this way — do NOT skip just because the form isn't shown yet.",
    "- ONLY end with `RESULT: skipped — <reason>` if the page truly has no way to apply to THIS job: a generic careers/listing page with no apply control, an expired/removed posting, a 404/error, or clearly the wrong page. (Skipped jobs are marked handled so they aren't retried.)",
    "- If clicking Apply makes no progress after ~2 tries, treat it as not reachable → skipped.",
    "- NEVER dump the whole page (no document.body.innerHTML / innerText of the full page) — read the snapshot; dumping blows the token limit.",
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
  claudeMcpCwd,
  claudeEngine = "cli", // "cli" (playwright-cli) | "mcp" (Playwright MCP)
  // Accepted-but-unused (codex-specific) so the batch loop can pass one shape:
  autoSubmit, proxyUrl, codexPath, runId, images, resumeGenerating,
}) {
  const step = (level, title, detail) => emit({ type: "step", level, title, detail });

  emit({ type: "status", phase: "starting", message: `Agent "${agentName}" booting for ${profile.fullName}` });
  emit({ type: "meta", profileName: profile.fullName, model, resumeStack: profile.resumeStack, resumePath: profile.resumePath, url, role: job?.title, company: job?.company });
  step("info", "Profile", `${profile.fullName} · resume: ${profile.resumeStack || "default"}`);
  // MCP mode: write a per-run config (isolated browser → concurrent agents; + the
  // applicant's saved Google session if connected → logged in, no re-verify), and
  // run from its CLAUDE.md-free temp dir so the agent uses the MCP (not the CLI).
  let cwd = claudeEngine === "mcp" ? (claudeMcpCwd || claudeCwd) : claudeCwd;
  let mcpConfig;
  let usingSession = false;
  if (claudeEngine === "mcp") {
    const built = writeRunMcpConfig({ applierName: profile.fullName, runId });
    cwd = built.dir;
    mcpConfig = built.config;
    usingSession = built.usingSession;
  }
  step("info", "Engine", `claude-code → ${model} · ${claudeEngine === "mcp" ? `Playwright MCP${usingSession ? " (saved Google session)" : ""}` : "playwright-cli"}`);

  // Running total, accumulated from per-turn usage DELTAS emitted by the runner.
  // We forward each delta as its own dashboard usage event (priced at DeepSeek
  // rates), so cost ticks up in real time and a killed run still reports the
  // input cost already spent.
  let total = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
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
      case "usage": {
        const d = claudeUsage(model, e.usage || {}); // price this turn's delta
        total = {
          inputTokens: total.inputTokens + d.inputTokens,
          cachedTokens: total.cachedTokens + d.cachedTokens,
          outputTokens: total.outputTokens + d.outputTokens,
          totalTokens: total.totalTokens + d.totalTokens,
          costUsd: total.costUsd + d.costUsd,
        };
        emit({
          type: "usage", model,
          inputTokens: d.inputTokens, cachedTokens: d.cachedTokens, outputTokens: d.outputTokens,
          totalTokens: d.totalTokens, costUsd: d.costUsd, priced: d.priced, costLabel: d.costLabel,
        });
        break;
      }
      default:
        break;
    }
  };

  // Secrets passed via env (never in the prompt) so Claude Code can self-resolve
  // login/OTP gates with its shell + Playwright tools if it needs to.
  // PLAYWRIGHT_CLI_SESSION scopes every `playwright-cli` command to THIS run's
  // own browser (concurrent agents stay isolated) and matches the session the
  // batch teardown closes — same scheme as the codex path.
  const gateEnv = {
    PLAYWRIGHT_CLI_SESSION: sessionForRun(runId, agentName),
    GMAIL_ADDRESS: profile.email || "",
    GMAIL_APP_PASSWORD: profile.gmailAppPassword || "",
    APPLICANT_PASSWORD: profile.defaultPassword || "",
  };

  const res = await runClaudeAgent({
    claudeBin,
    cwd,
    mcpConfig,
    model,
    apiKey,
    env: gateEnv,
    prompt: buildClaudeApplyPrompt({ url, job, profile, resumePath: profile.resumePath, resumeGenerating, engine: claudeEngine }),
    onEvent,
    signal,
  });

  // Per-turn deltas were already emitted above; the done event just carries the
  // accumulated total (no extra usage emit, to avoid double-counting).
  const usage = { ...total, priced: true, costLabel: formatUsd(total.costUsd) };

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
