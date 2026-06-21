/*
 * wait_stable.js — smart wait between wizard steps. Resolves when the page has settled,
 * instead of a blind fixed sleep or tight-polling snapshots.
 *
 *   playwright-cli run-code --filename=scripts/wait_stable.js
 *
 * run-code only receives `page` (no process/env/args), so this is parameterless: it waits
 * for DOM-ready + network-idle (capped) + common spinners hidden. For a SEMANTIC wait on
 * specific content, use a one-off instead, e.g.:
 *   playwright-cli run-code "async page => page.getByText('Review your application').first().waitFor()"
 *   playwright-cli run-code "async page => page.getByText('Loading').first().waitFor({state:'hidden'})"
 *
 * Never throws on timeout — returns what it observed so the caller can re-snapshot and decide.
 */
async page => {
  const started = Date.now();
  const did = [];
  const tryStep = async (label, fn) => {
    try { await fn(); did.push(label); } catch { did.push(label + ":timeout"); }
  };

  await tryStep("domcontentloaded", () =>
    page.waitForLoadState("domcontentloaded", { timeout: 8000 }));

  // Network settles (capped so a chatty analytics page can't hang us).
  await tryStep("networkidle", () =>
    page.waitForLoadState("networkidle", { timeout: 8000 }));

  // Common spinners gone (ignored if none exist).
  await tryStep("spinner-hidden", () =>
    page.locator('[role=progressbar], [aria-busy=true], .spinner, .loading, .loader')
      .first().waitFor({ state: "hidden", timeout: 8000 }));

  return {
    stable: true,
    waitedMs: Date.now() - started,
    steps: did,
    title: await page.title().catch(() => ""),
    url: page.url(),
  };
}
