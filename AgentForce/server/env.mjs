// Loads configuration + resolves the paths the agent backend needs.
// The OpenAI key comes from codex/.env (so the user does not sign in).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PATHS = {
  server: __dirname,
  agentforce: path.resolve(__dirname, ".."),
  codex: path.resolve(__dirname, "..", ".."),
  coreBackend: path.resolve(__dirname, "..", "..", "core-backend"),
  autoApply: path.resolve(__dirname, "..", "..", "auto-apply"),
  envFile: path.resolve(__dirname, "..", "..", ".env"),
  // codex-rs engine binary + the Responses↔DeepSeek translation proxy entry.
  codexBin: path.resolve(__dirname, "..", "..", "codex-rs", "target", "release", "codex"),
  deepseekProxy: path.resolve(__dirname, "..", "..", "deepseek-responses-proxy", "src", "index.mjs"),
};

// Minimal .env parser (KEY=VALUE, ignores comments/quotes). Avoids a dependency.
function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

const fileEnv = parseEnvFile(PATHS.envFile);

export const CONFIG = {
  port: Number(process.env.PORT || 8787),
  // process.env wins over the .env file so the key can also be exported in the shell.
  openaiApiKey: process.env.OPENAI_API_KEY || fileEnv.OPENAI_API_KEY || "",
  // DeepSeek fallback credential (used when a profile has no per-user key).
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || fileEnv.DEEPSEEK_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || fileEnv.OPENAI_MODEL || "gpt-4o-mini",
  // codex-rs engine: binary path (override with CODEX_BIN) + the local DeepSeek
  // translation proxy's port (codex talks to it for deepseek-* models).
  codexBin: process.env.CODEX_BIN || fileEnv.CODEX_BIN || PATHS.codexBin,
  deepseekProxyPort: Number(process.env.DEEPSEEK_PROXY_PORT || fileEnv.DEEPSEEK_PROXY_PORT || 8788),
  // Headless is read from auto-apply's playwright config; the user asked for headed.
  pwSession: process.env.PW_SESSION || "agentforce",
  // Set AUTO_SUBMIT=false to stop at the review gate (used while developing).
  autoSubmit: (process.env.AUTO_SUBMIT ?? "true") !== "false",
};

export function maskKey(k) {
  if (!k) return "(none)";
  return `${k.slice(0, 7)}…${k.slice(-4)} (${k.length} chars)`;
}
