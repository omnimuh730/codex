// Lifecycle for the local Responses↔DeepSeek translation proxy.
//
// codex talks to this proxy (Responses API) for deepseek-* models; the proxy
// forwards each request's Bearer token (the profile's DeepSeek key) to DeepSeek.
// It holds no key itself, so we just need it running on a known port. Spawned
// lazily on the first DeepSeek run and reused.

import { spawn } from "node:child_process";
import { PATHS, CONFIG } from "./env.mjs";

let child = null;
let starting = null;

export function deepseekProxyUrl() {
  return `http://127.0.0.1:${CONFIG.deepseekProxyPort}/v1`;
}

async function healthy() {
  try {
    const r = await fetch(`http://127.0.0.1:${CONFIG.deepseekProxyPort}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Ensure the proxy is running (idempotent); returns its base URL. */
export async function ensureDeepSeekProxy() {
  if (await healthy()) return deepseekProxyUrl();
  if (starting) return starting;
  starting = (async () => {
    child = spawn(process.execPath, [PATHS.deepseekProxy], {
      env: { ...process.env, PORT: String(CONFIG.deepseekProxyPort) },
      stdio: "ignore",
    });
    child.on("exit", () => {
      child = null;
    });
    for (let i = 0; i < 50; i++) {
      if (await healthy()) return deepseekProxyUrl();
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`deepseek-responses-proxy did not become healthy on port ${CONFIG.deepseekProxyPort}`);
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

export function stopDeepSeekProxy() {
  if (child) {
    child.kill();
    child = null;
  }
}
