// Drive Claude Code (the `claude` CLI) as the agent for one job application.
//
// Mirror of codex-runner.mjs, but for the claude-code provider. Claude Code IS
// the agent: it reasons, drives a real browser through the Playwright MCP server
// (configured in the claude-code workspace's .mcp.json) and the Playwright CLI,
// observes results, and verifies — all itself. We only compose a short prompt,
// spawn `claude` in headless stream-json mode, and relay its event stream.
//
// For DeepSeek models, Claude Code is pointed at DeepSeek's Anthropic-compatible
// endpoint via ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL.

import { spawn } from "node:child_process";
import readline from "node:readline";
import { isDeepSeekModel } from "../../core-backend/src/models.mjs";

// DeepSeek's Anthropic-compatible endpoint (distinct from its OpenAI /v1 one).
const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

/** Env that points the `claude` CLI at the right provider for `model`. */
export function providerEnv(model, apiKey) {
  if (isDeepSeekModel(model)) {
    return {
      ANTHROPIC_BASE_URL: DEEPSEEK_ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: apiKey || "",
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
  }
  // Anthropic-native: a real Claude model + Anthropic key.
  return { ANTHROPIC_API_KEY: apiKey || "", ANTHROPIC_MODEL: model };
}

/** Build the `claude` argv for one headless run. */
export function buildArgs({ model, resumeSessionId }) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    // Unattended: never prompt for tool/permission approval. The claude-code
    // workspace also pre-allows Playwright MCP + CLI in .claude/settings.json.
    "--permission-mode", "bypassPermissions",
  ];
  if (model) args.push("--model", model);
  // Continue a prior session after a handoff (not used yet, kept symmetric).
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  return args;
}

/** Short tool label, e.g. mcp__playwright__browser_navigate → playwright/navigate. */
function toolLabel(name = "") {
  const m = /^mcp__([^_]+)__(.+)$/.exec(name);
  if (m) return `${m[1]}/${m[2].replace(/^browser_/, "")}`;
  return name;
}

/**
 * Normalize a raw claude stream-json event into a compact dashboard event,
 * matching codex-runner's mapEvent vocabulary. Returns null when ignored.
 */
export function mapEvent(ev) {
  switch (ev?.type) {
    case "system":
      return ev.subtype === "init" ? { kind: "meta", threadId: ev.session_id } : null;
    case "assistant": {
      const content = ev.message?.content || [];
      const out = [];
      for (const c of content) {
        if (c.type === "text" && c.text?.trim()) out.push({ kind: "message", text: c.text });
        else if (c.type === "tool_use") {
          const label = toolLabel(c.name);
          const isBrowser = /playwright|browser/i.test(c.name || "");
          out.push({
            kind: isBrowser ? "command" : "tool",
            status: "running",
            command: `${label} ${JSON.stringify(c.input || {})}`.slice(0, 200),
            tool: label,
            server: "claude",
          });
        }
      }
      return out.length ? out : null;
    }
    case "user": {
      // Tool results coming back to the model — surface tersely as command output.
      const content = ev.message?.content || [];
      for (const c of content) {
        if (c.type === "tool_result") {
          const text = Array.isArray(c.content)
            ? c.content.map((p) => p.text || "").join(" ")
            : String(c.content || "");
          return { kind: "command", status: "completed", output: text.slice(0, 140) };
        }
      }
      return null;
    }
    case "result":
      // Usage is accounted per-turn in runClaudeAgent (real-time, survives a kill),
      // so we do NOT emit a usage lump here — only the final message/failure are read.
      return null;
    default:
      return null;
  }
}

/**
 * Run one Claude Code turn for a job application.
 *
 * @param {object} o
 * @param {string} o.claudeBin   the `claude` binary (name on PATH or absolute path)
 * @param {string} o.cwd         the claude-code workspace (holds .mcp.json + settings)
 * @param {string} o.model       e.g. "deepseek-v4-flash"
 * @param {string} o.prompt      the (short) task prompt, passed on stdin
 * @param {string} o.apiKey      provider key (DeepSeek or Anthropic)
 * @param {object} [o.env]       extra env (gate secrets etc.)
 * @param {(e:object)=>void} [o.onEvent]
 * @param {AbortSignal} [o.signal]
 * @param {object} [o.deps]      { spawn } injectable for tests
 */
export async function runClaudeAgent(o) {
  const spawnFn = o.deps?.spawn || spawn;
  const args = buildArgs({ model: o.model, resumeSessionId: o.resumeSessionId });

  const env = {
    ...process.env,
    ...(o.env || {}),
    ...providerEnv(o.model, o.apiKey),
  };
  const child = spawnFn(o.claudeBin, args, { cwd: o.cwd, env, signal: o.signal });

  let usage = null;
  let costUsd = null;
  let finalMessage = "";
  let sessionId = null;
  let failure = null;
  const stderr = [];
  // Swallow the ABORT_ERR a signal-spawned child emits on Stop/Pause — otherwise
  // Node re-throws it as uncaught and kills the agent-bff process.
  child.on("error", (err) => {
    if (err?.code === "ABORT_ERR" || err?.name === "AbortError") return;
    stderr.push(`spawn error: ${err?.message || err}`);
  });

  child.stdin.write(o.prompt || "");
  child.stdin.end();
  if (child.stderr) child.stderr.on("data", (d) => stderr.push(String(d)));

  const emit = (mapped) => {
    if (!mapped || !o.onEvent) return;
    for (const e of Array.isArray(mapped) ? mapped : [mapped]) o.onEvent(e);
  };

  // Real-time, kill-resilient usage accounting. Each assistant turn carries its
  // own input/cache usage (DeepSeek bills cache_read on every turn), but the
  // stream emits each assistant message TWICE with identical usage — so we count
  // each message id once. output_tokens only arrives in the final `result`.
  // We emit a per-turn DELTA usage event; callers accumulate it, so even if the
  // process is killed mid-run the spent input cost is already reported.
  const seenMsgIds = new Set();
  const acc = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
  const emitUsageDelta = (d) => {
    acc.input_tokens += d.input_tokens || 0;
    acc.cache_read_input_tokens += d.cache_read_input_tokens || 0;
    acc.cache_creation_input_tokens += d.cache_creation_input_tokens || 0;
    acc.output_tokens += d.output_tokens || 0;
    if (o.onEvent) o.onEvent({ kind: "usage", usage: d });
  };

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init") sessionId = ev.session_id;
    if (ev.type === "assistant") {
      const u = ev.message?.usage;
      const id = ev.message?.id;
      if (u && id && !seenMsgIds.has(id)) {
        seenMsgIds.add(id);
        emitUsageDelta({
          input_tokens: u.input_tokens || 0,
          cache_read_input_tokens: u.cache_read_input_tokens || 0,
          cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
          output_tokens: 0,
        });
      }
    }
    if (ev.type === "result") {
      // Output (only known now) + reconcile any input/cache the per-turn sum missed.
      const ru = ev.usage || {};
      const dOut = (ru.output_tokens || 0) - acc.output_tokens;
      const dIn = (ru.input_tokens ?? acc.input_tokens) - acc.input_tokens;
      const dCache = (ru.cache_read_input_tokens ?? acc.cache_read_input_tokens) - acc.cache_read_input_tokens;
      if (dOut > 0 || dIn > 0 || dCache > 0) {
        emitUsageDelta({
          input_tokens: Math.max(0, dIn),
          cache_read_input_tokens: Math.max(0, dCache),
          output_tokens: Math.max(0, dOut),
        });
      }
      costUsd = ev.total_cost_usd ?? costUsd;
      if (ev.subtype && ev.subtype !== "success") failure = ev.result || `claude ${ev.subtype}`;
      if (ev.result) finalMessage = ev.result;
    }
    emit(mapEvent(ev));
  }

  usage = acc; // accumulated total (reflects partial spend even if aborted)
  const exitCode = await new Promise((r) => child.on("exit", (c) => r(c ?? 1)));
  return { threadId: sessionId, finalMessage, usage, costUsd, exitCode, failure, stderr: stderr.join("") };
}
