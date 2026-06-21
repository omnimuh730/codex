// Translate an OpenAI **Responses API** request body (what codex-rs sends to
// `POST /v1/responses`) into a DeepSeek **Chat Completions** request body.
//
// The Responses request shape is defined by codex-rs; see
// codex-rs/core/tests/common/responses.rs for the authoritative fixtures:
//   - `instructions`: system prompt string
//   - `input[]`: ordered items — `message` (role + content parts), `function_call`
//     (call_id/name/arguments), `function_call_output` (call_id/output)
//   - `tools[]`: tool defs (we forward `function` tools; codex's shell arrives as
//     a function tool named e.g. "shell_command")
//   - `model`, optional `text.format` / output schema
//
// We deliberately support only the subset codex emits for this use case. Tool
// types DeepSeek can't honor (web_search / tool_search / namespace / custom) are
// dropped — per requirements, the agent only drives playwright via the shell tool.

/** Normalize a Responses `content` field (string | parts[]) into chat content. */
function normalizeContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const span of content) {
    const t = span?.type;
    if (t === "input_text" || t === "output_text" || t === "text") {
      parts.push({ type: "text", text: String(span.text ?? "") });
    } else if (t === "input_image") {
      // Responses uses a bare `image_url` string; chat wants { url }.
      const url = typeof span.image_url === "string" ? span.image_url : span.image_url?.url;
      if (url) parts.push({ type: "image_url", image_url: { url } });
    }
  }
  // Collapse a single text part to a plain string (DeepSeek prefers strings and
  // some models reject content arrays on system/assistant turns).
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

/** Responses `function_call_output.output` → a plain string for a tool message. */
function normalizeOutput(output) {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .filter((p) => p?.type === "input_text" || p?.type === "output_text" || p?.type === "text")
      .map((p) => String(p.text ?? ""))
      .join("");
  }
  if (typeof output === "object") {
    if (typeof output.content === "string") return output.content;
    return JSON.stringify(output);
  }
  return String(output);
}

const roleFor = (role) => (role === "developer" ? "system" : role || "user");

/** Convert the Responses `input[]` array into DeepSeek chat `messages[]`. */
function inputToMessages(input) {
  const messages = [];
  // Consecutive function_call items are one assistant turn's (possibly parallel)
  // tool calls. DeepSeek requires them in a SINGLE assistant message, immediately
  // followed by one `tool` message per call_id — so accumulate and flush.
  let pendingCalls = [];
  const flush = () => {
    if (pendingCalls.length) {
      messages.push({ role: "assistant", content: "", tool_calls: pendingCalls });
      pendingCalls = [];
    }
  };
  for (const item of Array.isArray(input) ? input : []) {
    switch (item?.type) {
      case "function_call":
      case "local_shell_call":
        pendingCalls.push({
          id: item.call_id,
          type: "function",
          function: {
            name: item.name || "shell",
            arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        });
        break;
      case "function_call_output":
      case "local_shell_call_output":
        flush(); // the assistant tool_calls message must precede the tool outputs
        messages.push({ role: "tool", tool_call_id: item.call_id, content: normalizeOutput(item.output) });
        break;
      case "message":
        flush();
        messages.push({ role: roleFor(item.role), content: normalizeContent(item.content) });
        break;
      // `reasoning` items carry encrypted CoT; DeepSeek can't consume them as
      // input, so drop them (thinking is disabled upstream anyway).
      default:
        flush();
        break;
    }
  }
  flush();
  return messages;
}

/** Forward only `function` tools, in DeepSeek's nested `{type, function}` shape. */
function toolsToChat(tools) {
  if (!Array.isArray(tools)) return undefined;
  const out = [];
  for (const tool of tools) {
    if (tool?.type !== "function") continue; // drop web_search/custom/namespace/etc.
    out.push({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.parameters ?? { type: "object", properties: {} },
      },
    });
  }
  return out.length ? out : undefined;
}

/** Map a Responses structured-output spec to a DeepSeek `response_format`. */
function responseFormat(body) {
  const fmt = body?.text?.format ?? body?.response_format;
  if (fmt?.type === "json_schema" || fmt?.type === "json_object") return fmt;
  if (body?.output_schema) {
    return { type: "json_schema", json_schema: { name: "output", schema: body.output_schema, strict: true } };
  }
  return undefined;
}

/**
 * Build the DeepSeek chat request. `stream_options.include_usage` is required so
 * the final stream chunk carries token usage (which we surface in
 * `response.completed`).
 */
export function translateRequest(body) {
  const messages = [];
  if (typeof body?.instructions === "string" && body.instructions.length) {
    messages.push({ role: "system", content: body.instructions });
  }
  messages.push(...inputToMessages(body?.input));

  const chat = {
    model: body?.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // Disable DeepSeek's internal thinking: codex already reasons across the
    // agentic conversation, and thinking mode requires `reasoning_content` to be
    // echoed back on every follow-up turn (which the Responses↔Chat round-trip
    // doesn't carry) — causing 400s mid-run. Verified param: {type:"disabled"}.
    thinking: { type: "disabled" },
  };
  const tools = toolsToChat(body?.tools);
  if (tools) {
    chat.tools = tools;
    if (body?.tool_choice) chat.tool_choice = body.tool_choice;
  }
  const rf = responseFormat(body);
  if (rf) chat.response_format = rf;
  if (typeof body?.temperature === "number") chat.temperature = body.temperature;
  if (typeof body?.max_output_tokens === "number") chat.max_tokens = body.max_output_tokens;
  return chat;
}
