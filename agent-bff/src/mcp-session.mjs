// MCP browser session helpers for the claude-code MCP driver.
//
// - Concurrency: each run gets `--isolated` (its own in-memory browser), so
//   parallel agents never collide on a shared profile dir.
// - Reusable login: if the applicant has a saved Google session (created by
//   `claude-code/agent/connect-google.mjs`), each run loads a COPY of it via
//   `--storage-state` — logged in, no re-verify, on any number of agents.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG } from "./config.mjs";

/** Must match claude-code/agent/sessions.mjs `safeApplier`. */
export function safeApplier(name) {
  return String(name || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "applicant";
}

export function sessionFileFor(applierName) {
  return path.join(CONFIG.claudeCwd, ".sessions", `${safeApplier(applierName)}.json`);
}

export function hasSavedSession(applierName) {
  try { return fs.existsSync(sessionFileFor(applierName)); } catch { return false; }
}

/**
 * Write a per-run MCP config (Playwright isolated + optional saved session + Gmail)
 * into a throwaway dir that has NO CLAUDE.md, and return { dir, config }. The MCP
 * driver runs `claude` with cwd=dir and --mcp-config=config so each run is isolated
 * and (if available) pre-authenticated.
 */
export function writeRunMcpConfig({ applierName, runId }) {
  const pwArgs = ["-y", "@playwright/mcp@latest", "--isolated"];
  const session = sessionFileFor(applierName);
  const usingSession = fs.existsSync(session);
  if (usingSession) pwArgs.push("--browser", "chrome", "--storage-state", session);

  const gmailDir = path.join(CONFIG.claudeCwd, "mcps", "gmail");
  const config = {
    mcpServers: {
      playwright: { command: "npx", args: pwArgs },
      gmail: {
        command: path.join(gmailDir, ".venv", "bin", "python"),
        args: [path.join(gmailDir, "server.py")],
      },
    },
  };

  const dir = path.join(os.tmpdir(), "nextoffer-mcp", String(runId || Date.now().toString(36)));
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, ".mcp.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { dir, config: configPath, usingSession };
}
