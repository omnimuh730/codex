# deepseek-responses-proxy

codex-rs speaks **only** the OpenAI **Responses API** (`wire_api = "responses"`, `POST
/v1/responses`). DeepSeek speaks **only** Chat Completions (`POST /chat/completions`). This proxy
translates between them so codex-rs can run on DeepSeek.

```
codex-rs ──Responses──▶ deepseek-responses-proxy ──Chat Completions──▶ DeepSeek API
```

## What it translates

**Request** (`/v1/responses` → DeepSeek chat), in `src/translate-request.mjs`:
- `instructions` → leading `system` message
- `input[]` → chat `messages`: `message` (input_text/input_image), `function_call` → assistant
  `tool_calls`, `function_call_output` → `tool` message
- `tools[]` → only `function` tools are forwarded (web_search / tool_search / custom are dropped —
  the agent only drives playwright via the shell tool)
- adds `stream: true` + `stream_options.include_usage` so the final chunk carries token usage

**Response stream** (DeepSeek chat SSE → Responses SSE), in `src/translate-stream.mjs` — emits the
exact event set codex parses (`codex-rs/core/tests/common/responses.rs`):
`response.created` → `response.output_item.added` → `response.output_text.delta` /
`response.reasoning_text.delta` → `response.output_item.done` (message / `function_call`) →
`response.completed` (with `usage`) / `response.failed`. DeepSeek `reasoning_content` →
`reasoning_text.delta`; streamed `tool_calls` → a `function_call` item; `prompt_cache_hit_tokens` →
`usage.input_tokens_details.cached_tokens`.

## Run

```bash
DEEPSEEK_API_KEY=sk-... PORT=8788 node src/index.mjs
# health: GET http://127.0.0.1:8788/health
```

Env: `DEEPSEEK_API_KEY` (required), `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/v1`),
`PORT` (default 8788), `PROXY_AUTH_TOKEN` (optional shared secret; when set, the inbound
`Authorization: Bearer` from codex must match).

## Point codex-rs at it

In `~/.codex/config.toml` (or via the SDK's `config` overrides):

```toml
[model_providers.deepseek_proxy]
name = "DeepSeek (via proxy)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
env_key = "CODEX_API_KEY"   # value is sent as the proxy's Bearer token

[profiles.deepseek]
model_provider = "deepseek_proxy"
model = "deepseek-v4-flash"   # or deepseek-v4-pro
```

## Test

```bash
node --test
```

Unit tests cover request translation, stream translation (text / reasoning / tool calls / usage /
errors), SSE round-trip, and an end-to-end server pass with an injected fake DeepSeek upstream.

## Status / limitations

- **Verified:** unit + server-integration tests (11) pass.
- **Pending:** live validation against a built codex binary (`codex exec` against the proxy) — done
  as part of Stage 2, after the codex binary is built. The proxy is scoped to the Responses subset
  codex emits for this agent; reasoning *items* are surfaced as deltas only (no fabricated
  `encrypted_content`). DeepSeek image/vision support is assumed and revisited after testing.
