import { spawn } from "node:child_process";
import { PATHS, CONFIG } from "./config.mjs";

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
