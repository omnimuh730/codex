// Server-Sent Events helpers shared by the proxy.
//
// Two directions:
//  - encodeEvent(): format a Responses API event the way codex-rs expects to
//    read it — an `event: <type>` line, a `data: <json>` line, blank line.
//    (Matches codex-rs/core/tests/common/responses.rs `sse()`.)
//  - parseSseStream(): incrementally parse the DeepSeek upstream's chat SSE
//    (`data: {json}` / `data: [DONE]`) into JS objects.

/** Format one Responses SSE event. `event` MUST carry a `type` field. */
export function encodeEvent(event) {
  const type = event?.type;
  if (!type) throw new Error("SSE event is missing a `type`");
  return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Turn an async iterable of byte/string chunks (a fetch Response body) into an
 * async iterable of parsed JSON objects, one per `data:` line. The sentinel
 * `data: [DONE]` ends the stream. Lines that are not JSON are skipped.
 */
export async function* parseSseStream(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl;
    // SSE events are separated by a blank line, but DeepSeek emits one JSON
    // object per `data:` line, so splitting on newlines is sufficient.
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue; // blank / comment
      if (!trimmed.startsWith("data:")) continue; // ignore `event:` etc.
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        /* ignore malformed partials; DeepSeek never splits a JSON across lines */
      }
    }
  }
}
