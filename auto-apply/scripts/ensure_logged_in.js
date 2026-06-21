/*
 * ensure_logged_in.js — detect whether the current page is behind an auth gate.
 *
 *   playwright-cli run-code --filename=scripts/ensure_logged_in.js
 *   -> { authenticated, needsManualLogin, signals }
 *
 * run-code only receives `page` (no process/env/args), so this only DETECTS. Saving and
 * restoring login state use the native CLI commands (they cannot run inside run-code):
 *
 *   # after the human logs in manually, persist the session:
 *   playwright-cli state-save .playwright/auth-state.json
 *   # on a later run, restore it before navigating:
 *   playwright-cli state-load .playwright/auth-state.json
 *
 * G2: if needsManualLogin is true, tell the human to log in, leave the browser open, wait,
 * then state-save. NEVER type a password or create an account yourself.
 */
async page => {
  const signals = await page.evaluate(() => {
    const txt = ((document.body && document.body.innerText) || "").toLowerCase();
    const has = (sel) => !!document.querySelector(sel);
    const hasText = (re) => re.test(txt);
    const loginSignals = [];
    const authSignals = [];

    if (has('input[type=password]')) loginSignals.push("password field present");
    if (hasText(/\bsign in\b|\blog in\b|\blogin\b/)) loginSignals.push("sign-in text");
    if (hasText(/create account|create an account|register|sign up/)) loginSignals.push("create-account text");

    if (hasText(/\bsign out\b|\blog out\b|\blogout\b/)) authSignals.push("sign-out text");
    if (has('[aria-label*="account" i],[data-testid*="account" i],[class*="avatar" i]')) authSignals.push("account/avatar control");
    if (hasText(/my applications|my profile|dashboard/)) authSignals.push("authenticated landmark text");

    return { loginSignals, authSignals, url: location.href, title: document.title };
  });

  // A password field or explicit sign-in prompt, with no authenticated marker, => gated.
  const gated = signals.loginSignals.length > 0 && signals.authSignals.length === 0;
  return { authenticated: !gated, needsManualLogin: gated, signals };
}
