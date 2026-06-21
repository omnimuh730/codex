// Orphaned-browser cleanup.
//
// playwright-cli runs the browser as a DETACHED server (the Chrome-for-Testing
// windows reparent to launchd/PID 1), so a hard crash of the BFF or codex leaves
// the browser running with nothing in our process tree to reap it. On startup —
// and on demand — we sweep: close any `af-<runId>` session whose run is no longer
// active. A run's session name is deterministic (see sessionForRun), so we can map
// a live session back to its run and decide whether it's an orphan.

import { spawn } from "node:child_process";
import { closeBrowserSession } from "./codex-apply.mjs";

function run(cmd, args, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve({ code, out }); } };
    try {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish(-1); }, timeout);
      child.stdout.on("data", (d) => { out += String(d); });
      child.on("exit", (code) => { clearTimeout(t); finish(code ?? 0); });
      child.on("error", () => { clearTimeout(t); finish(-1); });
    } catch { finish(-1); }
  });
}

/** Live `af-*` session names known to playwright-cli. */
export async function listAgentSessions() {
  const { out } = await run("playwright-cli", ["list"]);
  return [...new Set((out.match(/af-[A-Za-z0-9_-]+/g) || []))];
}

/**
 * Close every agent browser session whose run is NOT active.
 * @param {(runId: string) => boolean} isRunActive  true if the run is still live.
 * @returns {Promise<string[]>} the session names that were closed.
 */
export async function sweepOrphanBrowsers(isRunActive = () => false) {
  const sessions = await listAgentSessions();
  const closed = [];
  for (const session of sessions) {
    const runId = session.replace(/^af-/, "");
    if (isRunActive(runId)) continue;
    await closeBrowserSession(session);
    closed.push(session);
  }
  return closed;
}
