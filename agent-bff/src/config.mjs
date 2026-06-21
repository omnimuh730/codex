import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PATHS = {
  server: __dirname,
  bff: path.resolve(__dirname, ".."),
  codex: path.resolve(__dirname, "..", ".."),
  coreBackend: path.resolve(__dirname, "..", "..", "core-backend"),
  autoApply: path.resolve(__dirname, "..", "..", "auto-apply"),
  envFile: path.resolve(__dirname, "..", "..", ".env"),
  codexBin: path.resolve(__dirname, "..", "..", "codex-rs", "target", "release", "codex"),
  deepseekProxy: path.resolve(__dirname, "..", "..", "deepseek-responses-proxy", "src", "index.mjs"),
};

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
const localEnvFile = path.resolve(PATHS.bff, ".env");
const localEnv = parseEnvFile(localEnvFile);

function env(key, fallback = "") {
  return process.env[key] || localEnv[key] || fileEnv[key] || fallback;
}

export const CONFIG = {
  port: Number(env("PORT", "8780")),
  mongoUri: env("MONGODB_URI", "mongodb://127.0.0.1:27017"),
  mongoDb: env("MONGODB_DB", "AthensDB"),
  openaiApiKey: env("OPENAI_API_KEY"),
  deepseekApiKey: env("DEEPSEEK_API_KEY"),
  openaiModel: env("OPENAI_MODEL", "gpt-4o-mini"),
  codexBin: env("CODEX_BIN") || PATHS.codexBin,
  deepseekProxyPort: Number(env("DEEPSEEK_PROXY_PORT", "8788")),
  pwSession: env("PW_SESSION", "athens-agent"),
  autoSubmit: (env("AUTO_SUBMIT") || "true") !== "false",
};

export function maskKey(k) {
  if (!k) return "(none)";
  return `${k.slice(0, 7)}…${k.slice(-4)} (${k.length} chars)`;
}
