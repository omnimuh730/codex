import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PATHS = {
  root: path.resolve(__dirname, ".."),
  data: path.resolve(__dirname, "..", "data"),
  envFile: path.resolve(__dirname, "..", "..", ".env"),
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

export const CONFIG = {
  mongoUri: process.env.MONGODB_URI || fileEnv.MONGODB_URI || "mongodb://localhost:27017",
  mongoDb: process.env.MONGODB_DB || fileEnv.MONGODB_DB || "AthensDB",
  openaiApiKey: process.env.OPENAI_API_KEY || fileEnv.OPENAI_API_KEY || "",
};
