// Read verification codes / verify-links from an applicant's Gmail (per-applicant creds
// from their MongoDB profile). Wraps mcps/gmail/otp_fetch.py (Python stdlib IMAP).
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OTP_SCRIPT = path.resolve(__dirname, "..", "..", "mcps", "gmail", "otp_fetch.py");

export function gmailConfigured(profile) {
  return !!(profile?.email && profile?.gmailAppPassword);
}

// One-shot fetch. Resolves { found, code, link, from, subject, date }.
export function fetchOtp({ gmailAddress, appPassword, match, sinceEpoch, limit = 15, query = "newer_than:1d" }) {
  return new Promise((resolve) => {
    const args = [OTP_SCRIPT, "--query", query, "--limit", String(limit)];
    if (match) args.push("--match", match);
    if (sinceEpoch) args.push("--since-epoch", String(sinceEpoch));
    execFile("python3", args, {
      env: { ...process.env, GMAIL_ADDRESS: gmailAddress, GMAIL_APP_PASSWORD: appPassword },
      timeout: 30000,
    }, (err, stdout) => {
      const line = String(stdout || "").trim().split("\n").filter(Boolean).pop() || "";
      try { resolve(JSON.parse(line)); }
      catch { resolve({ found: false, error: err ? String(err.message).slice(0, 120) : "no JSON output" }); }
    });
  });
}

// Poll until a verification email arrives (can take 30–120s). `onTick` reports attempts.
export async function waitForOtp({ gmailAddress, appPassword, match, sinceEpoch, attempts = 14, intervalMs = 8000, onTick }) {
  for (let i = 0; i < attempts; i++) {
    const r = await fetchOtp({ gmailAddress, appPassword, match, sinceEpoch });
    if (r.found && (r.code || r.link)) return r;
    if (onTick) onTick(i + 1, attempts);
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return { found: false };
}
