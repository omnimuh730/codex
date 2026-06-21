// Drive the codex-rs engine for one job application.
//
// codex-rs IS the agent now: it reasons, generates `playwright-cli` commands,
// runs them via its `exec_command` shell tool, observes output, and verifies —
// all inside its own sandbox. AgentForce only composes the task, spawns codex,
// and relays its event stream to the dashboard. No LLM call happens here.
//
// This is a minimal port of sdk/typescript/src/exec.ts to plain ESM, using THIS
// fork's flags (`codex exec --json`, not `--experimental-json`). For DeepSeek
// models, codex is pointed at the local deepseek-responses-proxy (Responses↔Chat).

import { spawn } from "node:child_process";
import readline from "node:readline";
import { isDeepSeekModel } from "../../core-backend/src/models.mjs";

// --- config flattening: { a: { b: 1 } } → ["a.b=1"] as TOML literals ----------
function tomlValue(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  throw new Error(`unsupported config value: ${typeof v}`);
}
function flattenConfig(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenConfig(v, path, out);
    else out.push(`${path}=${tomlValue(v)}`);
  }
  return out;
}

/**
 * Provider config injected via `--config`. DeepSeek → the local proxy speaking
 * the Responses API; OpenAI → codex's built-in provider (no proxy).
 */
export function providerConfig(model, { proxyUrl } = {}) {
  if (isDeepSeekModel(model)) {
    return {
      model_provider: "deepseek_proxy",
      model_providers: {
        deepseek_proxy: {
          name: "DeepSeek (via proxy)",
          base_url: proxyUrl || "http://127.0.0.1:8788/v1",
          wire_api: "responses",
          env_key: "CODEX_API_KEY",
        },
      },
    };
  }
  return { model_provider: "openai" };
}

/** Build the `codex exec` argv for one turn. Pass `resumeThreadId` to continue
 *  a prior session (`codex exec [flags] resume <id>`), e.g. after a human handoff. */
export function buildArgs({ model, workingDir, sandbox, approvalPolicy, images, outputSchemaFile, extraConfig, resumeThreadId }) {
  const config = { approval_policy: approvalPolicy || "never", ...extraConfig };
  const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox || "danger-full-access"];
  if (workingDir) args.push("--cd", workingDir);
  if (model) args.push("--model", model);
  if (outputSchemaFile) args.push("--output-schema", outputSchemaFile);
  for (const c of flattenConfig(config)) args.push("--config", c);
  // `resume <id>` is an exec subcommand and must follow the exec-level flags.
  // (Images aren't passed on resume — the resume subcommand doesn't take them.)
  if (resumeThreadId) args.push("resume", resumeThreadId);
  else for (const img of images || []) args.push("--image", img);
  return args;
}

/**
 * Normalize a raw codex JSONL event into a compact dashboard event. Returns null
 * for events the dashboard ignores. Pure → unit-testable.
 */
export function mapEvent(ev) {
  switch (ev?.type) {
    case "thread.started":
      return { kind: "meta", threadId: ev.thread_id };
    case "turn.started":
      return { kind: "status", message: "reasoning" };
    case "turn.completed":
      return { kind: "usage", usage: ev.usage };
    case "turn.failed":
      return { kind: "failed", message: ev.error?.message || "turn failed" };
    case "error":
      return { kind: "error", message: ev.message };
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = ev.item || {};
      const terminal = ev.type === "item.completed";
      switch (item.type) {
        case "command_execution":
          return {
            kind: "command",
            status: item.status,
            command: item.command,
            output: terminal ? item.aggregated_output : undefined,
            exitCode: item.exit_code,
          };
        case "agent_message":
          return terminal ? { kind: "message", text: item.text } : null;
        case "reasoning":
          return terminal ? { kind: "reasoning", text: item.text } : null;
        case "mcp_tool_call":
          return { kind: "tool", status: item.status, server: item.server, tool: item.tool };
        case "error":
          return { kind: "error", message: item.message };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/**
 * Run one codex turn for a job application.
 *
 * @param {object} o
 * @param {string} o.codexPath   absolute path to the codex binary
 * @param {string} o.model       e.g. "deepseek-v4-flash" or "gpt-5.4-mini"
 * @param {string} o.prompt      the full task prompt (written to codex stdin)
 * @param {string} o.apiKey      provider key: proxy token (DeepSeek) or OpenAI key
 * @param {string} o.workingDir  cwd for codex (the auto-apply playwright project)
 * @param {string[]} [o.images]  local image paths for vision re-plan
 * @param {string} [o.proxyUrl]  deepseek-responses-proxy base URL
 * @param {(e:object)=>void} [o.onEvent]  receives mapped dashboard events
 * @param {AbortSignal} [o.signal]
 * @param {object} [o.deps]      { spawn } injectable for tests
 */
export async function runCodexAgent(o) {
  const spawnFn = o.deps?.spawn || spawn;
  const args = buildArgs({
    model: o.model,
    workingDir: o.workingDir,
    sandbox: o.sandbox,
    approvalPolicy: o.approvalPolicy,
    images: o.images,
    outputSchemaFile: o.outputSchemaFile,
    extraConfig: providerConfig(o.model, { proxyUrl: o.proxyUrl }),
    resumeThreadId: o.threadId,
  });

  // codex authenticates to the proxy (DeepSeek) or OpenAI with CODEX_API_KEY.
  const env = { ...process.env, ...(o.env || {}), CODEX_API_KEY: o.apiKey || "" };
  const child = spawnFn(o.codexPath, args, { env, signal: o.signal });

  child.stdin.write(o.prompt || "");
  child.stdin.end();

  let usage = null;
  let finalMessage = "";
  let threadId = null;
  let failure = null;
  const stderr = [];
  if (child.stderr) child.stderr.on("data", (d) => stderr.push(String(d)));

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "thread.started") threadId = ev.thread_id;
    if (ev.type === "turn.completed") usage = ev.usage;
    if (ev.type === "turn.failed") failure = ev.error?.message || "turn failed";
    if (ev.type === "item.completed" && ev.item?.type === "agent_message") finalMessage = ev.item.text;
    const mapped = mapEvent(ev);
    if (mapped && o.onEvent) o.onEvent(mapped);
  }

  const exitCode = await new Promise((r) => child.on("exit", (c) => r(c ?? 1)));
  return { threadId, finalMessage, usage, exitCode, failure, stderr: stderr.join("") };
}
