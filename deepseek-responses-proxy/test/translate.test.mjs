import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { translateRequest } from "../src/translate-request.mjs";
import { translateStream, mapUsage } from "../src/translate-stream.mjs";
import { parseSseStream, encodeEvent } from "../src/sse.mjs";
import { createServer } from "../src/server.mjs";

// ---------------------------------------------------------------------------
// translateRequest: Responses body → DeepSeek chat body
// ---------------------------------------------------------------------------

test("translateRequest maps instructions, messages, and forces streaming usage", () => {
  const chat = translateRequest({
    model: "deepseek-v4-flash",
    instructions: "You are an agent.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
  });
  assert.equal(chat.model, "deepseek-v4-flash");
  assert.equal(chat.stream, true);
  assert.deepEqual(chat.stream_options, { include_usage: true });
  assert.deepEqual(chat.messages[0], { role: "system", content: "You are an agent." });
  assert.deepEqual(chat.messages[1], { role: "user", content: "hi" });
});

test("translateRequest maps function_call + output into assistant tool_calls + tool message", () => {
  const chat = translateRequest({
    model: "deepseek-v4-pro",
    input: [
      { type: "function_call", call_id: "call_1", name: "shell_command", arguments: '{"command":"ls"}' },
      { type: "function_call_output", call_id: "call_1", output: "file.txt" },
    ],
  });
  assert.deepEqual(chat.messages[0], {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "shell_command", arguments: '{"command":"ls"}' } }],
  });
  assert.deepEqual(chat.messages[1], { role: "tool", tool_call_id: "call_1", content: "file.txt" });
});

test("translateRequest groups parallel function_calls into one assistant message", () => {
  // codex emits parallel tool calls as consecutive function_call items; DeepSeek
  // needs them in ONE assistant message, then a tool message per call_id.
  const chat = translateRequest({
    model: "deepseek-v4-flash",
    input: [
      { type: "function_call", call_id: "c1", name: "exec_command", arguments: '{"cmd":"a"}' },
      { type: "function_call", call_id: "c2", name: "exec_command", arguments: '{"cmd":"b"}' },
      { type: "function_call_output", call_id: "c1", output: "out-a" },
      { type: "function_call_output", call_id: "c2", output: "out-b" },
    ],
  });
  assert.equal(chat.messages.length, 3);
  assert.equal(chat.messages[0].role, "assistant");
  assert.deepEqual(chat.messages[0].tool_calls.map((t) => t.id), ["c1", "c2"]);
  assert.deepEqual(chat.messages[1], { role: "tool", tool_call_id: "c1", content: "out-a" });
  assert.deepEqual(chat.messages[2], { role: "tool", tool_call_id: "c2", content: "out-b" });
});

test("translateRequest keeps image parts and developer→system", () => {
  const chat = translateRequest({
    model: "deepseek-v4-pro",
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "rules" }] },
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "data:image/png;base64,abc" },
        ],
      },
    ],
  });
  assert.equal(chat.messages[0].role, "system");
  assert.deepEqual(chat.messages[1].content, [
    { type: "text", text: "look" },
    { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
  ]);
});

test("translateRequest forwards only function tools (drops web_search/custom)", () => {
  const chat = translateRequest({
    model: "deepseek-v4-flash",
    input: [],
    tools: [
      { type: "function", name: "shell_command", description: "run", parameters: { type: "object" } },
      { type: "web_search" },
      { type: "custom", name: "apply_patch" },
    ],
  });
  assert.equal(chat.tools.length, 1);
  assert.equal(chat.tools[0].function.name, "shell_command");
});

// ---------------------------------------------------------------------------
// translateStream: DeepSeek chat chunks → Responses events
// ---------------------------------------------------------------------------

async function collect(asyncIter) {
  const out = [];
  for await (const v of asyncIter) out.push(v);
  return out;
}
async function* fromArray(arr) {
  for (const a of arr) yield a;
}

test("translateStream emits created → item.added → text deltas → item.done → completed", async () => {
  const chunks = [
    { id: "ds1", choices: [{ delta: { content: "Hel" }, finish_reason: null }] },
    { id: "ds1", choices: [{ delta: { content: "lo" }, finish_reason: null }] },
    { id: "ds1", choices: [{ delta: {}, finish_reason: "stop" }] },
    { id: "ds1", choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4 } },
  ];
  const events = await collect(translateStream(fromArray(chunks)));
  const types = events.map((e) => e.type);
  assert.deepEqual(types, [
    "response.created",
    "response.output_item.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_item.done",
    "response.completed",
  ]);
  assert.equal(events[0].response.id, "ds1");
  const doneMsg = events[4].item;
  assert.equal(doneMsg.type, "message");
  assert.deepEqual(doneMsg.content, [{ type: "output_text", text: "Hello" }]);
  assert.deepEqual(events[5].response.usage, {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 4 },
    output_tokens: 2,
    output_tokens_details: null,
    total_tokens: 12,
  });
});

test("translateStream surfaces reasoning_content as reasoning_text.delta", async () => {
  const chunks = [
    { id: "r1", choices: [{ delta: { reasoning_content: "thinking" }, finish_reason: null }] },
    { id: "r1", choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
  ];
  const events = await collect(translateStream(fromArray(chunks)));
  assert.equal(events[1].type, "response.reasoning_text.delta");
  assert.equal(events[1].delta, "thinking");
});

test("translateStream assembles streamed tool_calls into a function_call item", async () => {
  const chunks = [
    { id: "t1", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "shell_command", arguments: '{"comm' } }] }, finish_reason: null }] },
    { id: "t1", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] }, finish_reason: null }] },
    { id: "t1", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  const events = await collect(translateStream(fromArray(chunks)));
  const fc = events.find((e) => e.item?.type === "function_call");
  assert.ok(fc, "expected a function_call item");
  assert.equal(fc.item.call_id, "call_9");
  assert.equal(fc.item.name, "shell_command");
  assert.equal(fc.item.arguments, '{"command":"ls"}');
  assert.equal(events.at(-1).type, "response.completed");
});

test("translateStream maps an upstream error chunk to response.failed", async () => {
  const chunks = [{ error: { code: "rate_limit", message: "slow down" } }];
  const events = await collect(translateStream(fromArray(chunks)));
  const failed = events.find((e) => e.type === "response.failed");
  assert.ok(failed);
  assert.equal(failed.response.error.code, "rate_limit");
});

test("mapUsage falls back to prompt_tokens_details.cached_tokens", () => {
  const u = mapUsage({ prompt_tokens: 5, completion_tokens: 1, total_tokens: 6, prompt_tokens_details: { cached_tokens: 2 } });
  assert.deepEqual(u.input_tokens_details, { cached_tokens: 2 });
});

// ---------------------------------------------------------------------------
// sse round-trip + server integration (injected fetch)
// ---------------------------------------------------------------------------

test("encodeEvent + parseSseStream round-trip is lossless for data payloads", async () => {
  const wire = encodeEvent({ type: "response.output_text.delta", delta: "x" });
  const parsed = await collect(parseSseStream(fromArray([wire])));
  assert.deepEqual(parsed[0], { type: "response.output_text.delta", delta: "x" });
});

test("server /v1/responses streams translated Responses SSE end-to-end", async () => {
  // Fake DeepSeek upstream: returns an SSE body as an async iterable of strings.
  const deepseekSse = [
    'data: {"id":"ds","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n',
    'data: {"id":"ds","choices":[{"delta":{},"finish_reason":"stop"}]}\n',
    'data: {"id":"ds","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n',
    "data: [DONE]\n",
  ];
  const fakeFetch = async () => ({ ok: true, body: fromArray(deepseekSse) });

  const cfg = { port: 0, deepseekApiKey: "x", deepseekUrl: "http://unused", authToken: "" };
  const server = createServer(cfg, { fetch: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/v1/responses", method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ model: "deepseek-v4-flash", input: [{ type: "message", role: "user", content: "hi" }] }));
  });
  server.close();

  assert.match(body, /event: response\.created/);
  assert.match(body, /event: response\.output_text\.delta/);
  assert.match(body, /event: response\.completed/);
  // usage threaded through
  assert.match(body, /"input_tokens":3/);
});
