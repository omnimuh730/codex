// HTTP server: exposes `POST /v1/responses` (the Responses API endpoint codex-rs
// targets) and forwards each request to DeepSeek's Chat Completions API,
// translating both the request and the streamed response.
//
// Auth model: multi-tenant. Each applicant profile has its own DeepSeek key, so
// the proxy FORWARDS the inbound `Authorization: Bearer <key>` (which codex sends
// from its provider `env_key` value) straight to DeepSeek. `DEEPSEEK_API_KEY` is
// only a fallback for single-key/dev setups.

import http from "node:http";
import { translateRequest } from "./translate-request.mjs";
import { translateStream } from "./translate-stream.mjs";
import { encodeEvent, parseSseStream } from "./sse.mjs";

export function createConfig(env = process.env) {
  const base = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  return {
    port: Number(env.PORT || env.PROXY_PORT || 8788),
    deepseekApiKey: env.DEEPSEEK_API_KEY || "",
    deepseekUrl: `${base}/chat/completions`,
    authToken: env.PROXY_AUTH_TOKEN || "", // empty → don't enforce (dev)
  };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

/**
 * Stream a Responses SSE reply for one `/v1/responses` request. `deps.fetch` is
 * injectable for tests.
 */
async function handleResponses(req, res, cfg, deps) {
  const fetchFn = deps?.fetch || fetch;
  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return sendJson(res, 400, { error: { message: "invalid JSON body" } });
  }

  const chatBody = translateRequest(body);
  if (!chatBody.model) return sendJson(res, 400, { error: { message: "missing model" } });

  // The inbound Bearer (codex's per-profile key) is the DeepSeek key; fall back
  // to a server-wide key only if codex sent none.
  const upstreamKey = bearer(req) || cfg.deepseekApiKey;
  if (!upstreamKey) return sendJson(res, 401, { error: { message: "no DeepSeek API key (Bearer token or DEEPSEEK_API_KEY)" } });

  let upstream;
  try {
    upstream = await fetchFn(cfg.deepseekUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstreamKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(chatBody),
    });
  } catch (err) {
    return sendJson(res, 502, { error: { message: `DeepSeek unreachable: ${err.message}` } });
  }

  if (!upstream.ok || !upstream.body) {
    const text = (await upstream.text?.().catch(() => "")) ?? "";
    // Surface the upstream error as a clean Responses `response.failed` event over a
    // 200 stream — codex treats a non-200 HTTP status as a hard error and would
    // otherwise dump this raw SSE body as the message. Unwrap DeepSeek's JSON error.
    let message = text.slice(0, 500) || "DeepSeek error";
    try {
      const j = JSON.parse(text);
      if (j?.error?.message) message = j.error.message;
    } catch { /* leave raw text */ }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(encodeEvent({ type: "response.created", response: { id: "resp_err" } }));
    res.write(
      encodeEvent({
        type: "response.failed",
        response: { id: "resp_err", error: { code: String(upstream.status || 502), message } },
      }),
    );
    return res.end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  try {
    for await (const event of translateStream(parseSseStream(upstream.body))) {
      res.write(encodeEvent(event));
    }
  } catch (err) {
    res.write(
      encodeEvent({
        type: "response.failed",
        response: { id: "resp_err", error: { code: "proxy_error", message: String(err?.message || err) } },
      }),
    );
  }
  res.end();
}

export function createServer(cfg = createConfig(), deps = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, deepseekKey: Boolean(cfg.deepseekApiKey) });
    }
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      // The key is resolved per-request (inbound Bearer or fallback) inside.
      return handleResponses(req, res, cfg, deps);
    }
    sendJson(res, 404, { error: { message: "not found" } });
  });
}
