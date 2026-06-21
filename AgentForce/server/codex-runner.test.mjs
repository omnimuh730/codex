import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildArgs, providerConfig, mapEvent, runCodexAgent } from "./codex-runner.mjs";
import { createServer as createProxy } from "../../deepseek-responses-proxy/src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEX = path.resolve(__dirname, "../../codex-rs/target/release/codex");

// ---------------------------------------------------------------------------
// Pure units
// ---------------------------------------------------------------------------

test("providerConfig routes DeepSeek to the proxy and OpenAI to built-in", () => {
  const ds = providerConfig("deepseek-v4-flash", { proxyUrl: "http://127.0.0.1:9/v1" });
  assert.equal(ds.model_provider, "deepseek_proxy");
  assert.equal(ds.model_providers.deepseek_proxy.wire_api, "responses");
  assert.equal(ds.model_providers.deepseek_proxy.base_url, "http://127.0.0.1:9/v1");
  assert.deepEqual(providerConfig("gpt-5.4-mini"), { model_provider: "openai" });
});

test("buildArgs flattens config and sets exec flags", () => {
  const args = buildArgs({
    model: "deepseek-v4-flash",
    workingDir: "/tmp",
    extraConfig: providerConfig("deepseek-v4-flash", { proxyUrl: "http://p/v1" }),
  });
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--skip-git-repo-check"));
  assert.equal(args[args.indexOf("--model") + 1], "deepseek-v4-flash");
  assert.ok(args.some((a) => a === 'model_provider="deepseek_proxy"'));
  assert.ok(args.some((a) => a === 'model_providers.deepseek_proxy.wire_api="responses"'));
  assert.ok(args.some((a) => a === 'approval_policy="never"'));
});

test("mapEvent normalizes codex events", () => {
  assert.deepEqual(mapEvent({ type: "thread.started", thread_id: "t1" }), { kind: "meta", threadId: "t1" });
  assert.deepEqual(mapEvent({ type: "turn.completed", usage: { input_tokens: 1 } }), { kind: "usage", usage: { input_tokens: 1 } });
  assert.deepEqual(
    mapEvent({ type: "item.completed", item: { type: "agent_message", text: "hi" } }),
    { kind: "message", text: "hi" },
  );
  assert.equal(
    mapEvent({ type: "item.completed", item: { type: "command_execution", status: "completed", command: "ls", aggregated_output: "x", exit_code: 0 } }).command,
    "ls",
  );
  assert.equal(mapEvent({ type: "item.started", item: { type: "agent_message", text: "x" } }), null);
});

// ---------------------------------------------------------------------------
// End-to-end against the real codex binary (skipped if not built)
// ---------------------------------------------------------------------------

const haveCodex = fs.existsSync(CODEX);

test("runCodexAgent drives real codex through the proxy + fake DeepSeek", { skip: !haveCodex }, async () => {
  // Fake DeepSeek upstream returns a canned streamed reply + usage.
  const fake = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: "ds", choices: [{ delta: { content: "Applied successfully." }, finish_reason: "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "ds", choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_cache_hit_tokens: 8 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const fakePort = fake.address().port;

  const proxy = createProxy({
    port: 0,
    deepseekApiKey: "dummy",
    deepseekUrl: `http://127.0.0.1:${fakePort}/v1/chat/completions`,
    authToken: "",
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyPort = proxy.address().port;

  const events = [];
  const result = await runCodexAgent({
    codexPath: CODEX,
    model: "deepseek-v4-flash",
    proxyUrl: `http://127.0.0.1:${proxyPort}/v1`,
    apiKey: "dummy",
    workingDir: "/tmp",
    sandbox: "read-only",
    prompt: "Reply when done.",
    onEvent: (e) => events.push(e),
  });

  fake.close();
  proxy.close();

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.finalMessage, "Applied successfully.");
  assert.equal(result.usage.input_tokens, 20);
  assert.equal(result.usage.cached_input_tokens, 8);
  assert.ok(events.some((e) => e.kind === "message" && e.text === "Applied successfully."));
  assert.ok(events.some((e) => e.kind === "usage"));
});
