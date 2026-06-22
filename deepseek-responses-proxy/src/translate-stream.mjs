// Translate DeepSeek's Chat Completions SSE stream into the OpenAI Responses
// SSE event sequence that codex-rs consumes.
//
// codex parses these event types (see codex-rs/core/tests/common/responses.rs):
//   response.created
//   response.output_item.added        (message item, before text deltas)
//   response.output_text.delta
//   response.reasoning_text.delta     (DeepSeek `reasoning_content`)
//   response.output_item.done         (message  -> output_text; function_call -> name/args)
//   response.completed                (carries usage)
//   response.failed
//
// DeepSeek chat chunk shape:
//   { id, choices:[{ delta:{ content?, reasoning_content?, tool_calls?:[{index,id,function:{name,arguments}}] }, finish_reason? }], usage? }

let _seq = 0;
const genId = (prefix) => `${prefix}_${Date.now().toString(36)}${(_seq++).toString(36)}`;

/** Map a DeepSeek `usage` object to the Responses `usage` shape. */
export function mapUsage(usage) {
  const input = Number(usage?.prompt_tokens ?? 0) || 0;
  const output = Number(usage?.completion_tokens ?? 0) || 0;
  const total = Number(usage?.total_tokens ?? input + output) || 0;
  const cached = Number(usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0) || 0;
  const miss = Number(usage?.prompt_cache_miss_tokens ?? 0) || 0;
  const inputDetails = {};
  if (cached) inputDetails.cached_tokens = cached;
  if (miss) inputDetails.prompt_cache_miss_tokens = miss;
  return {
    input_tokens: input,
    input_tokens_details: Object.keys(inputDetails).length ? inputDetails : null,
    output_tokens: output,
    output_tokens_details: null,
    total_tokens: total,
  };
}

/**
 * Async generator: consumes parsed DeepSeek chat chunks, yields Responses event
 * objects (encode them with sse.encodeEvent before writing to the wire).
 */
export async function* translateStream(chunks) {
  let responseId = null;
  let createdSent = false;
  let messageItemId = null; // non-null once a message item has been "added"
  let messageText = "";
  let usage = null;
  // tool calls accumulated by stream index → { id, name, args }
  const toolCalls = new Map();
  let sawFinish = false;

  const ensureCreated = (id) => {
    if (createdSent) return;
    responseId = id || responseId || genId("resp");
    createdSent = true;
    return { type: "response.created", response: { id: responseId } };
  };

  for await (const chunk of chunks) {
    // Upstream error surfaced mid-stream.
    if (chunk?.error) {
      const ev = ensureCreated(chunk.id);
      if (ev) yield ev;
      yield {
        type: "response.failed",
        response: {
          id: responseId,
          error: { code: chunk.error.code || "deepseek_error", message: chunk.error.message || "DeepSeek error" },
        },
      };
      return;
    }

    if (!createdSent) {
      const ev = ensureCreated(chunk?.id);
      if (ev) yield ev;
    }
    if (chunk?.usage) usage = chunk.usage;

    const choice = chunk?.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};

    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length) {
      yield { type: "response.reasoning_text.delta", delta: delta.reasoning_content, content_index: 0 };
    }

    if (typeof delta.content === "string" && delta.content.length) {
      if (messageItemId == null) {
        messageItemId = genId("msg");
        yield {
          type: "response.output_item.added",
          item: { type: "message", role: "assistant", id: messageItemId, content: [] },
        };
      }
      messageText += delta.content;
      yield { type: "response.output_text.delta", delta: delta.content };
    }

    for (const tc of delta.tool_calls || []) {
      const idx = tc.index ?? 0;
      const acc = toolCalls.get(idx) || { id: null, name: "", args: "" };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (typeof tc.function?.arguments === "string") acc.args += tc.function.arguments;
      toolCalls.set(idx, acc);
    }

    if (choice.finish_reason && !sawFinish) {
      sawFinish = true;
      // Close the assistant message item (full text).
      if (messageItemId != null) {
        yield {
          type: "response.output_item.done",
          item: {
            type: "message",
            role: "assistant",
            id: messageItemId,
            content: [{ type: "output_text", text: messageText }],
          },
        };
      }
      // Emit each tool call as a function_call output item.
      for (const acc of toolCalls.values()) {
        yield {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: acc.id || genId("call"),
            name: acc.name || "shell",
            arguments: acc.args || "{}",
          },
        };
      }
    }
  }

  // `response.completed` is emitted last so the trailing usage-only chunk is
  // included. If the stream ended without an explicit finish, still complete.
  if (!createdSent) yield { type: "response.created", response: { id: responseId || genId("resp") } };
  yield { type: "response.completed", response: { id: responseId, usage: mapUsage(usage) } };
}
