/*
 * upload_file.js — attach a file to a HIDDEN <input type=file> that has no clickable control.
 *
 * PREFER the native command when there is a visible "Upload" / "Attach" button:
 *   playwright-cli click <ref-of-upload-button>     # opens the file chooser
 *   playwright-cli upload assets/resume.pdf          # provides the file (relative to cwd)
 *
 * Use THIS script only when the input is hidden and clicking does nothing. Because run-code
 * receives only `page` (no process/env/args), pass parameters via page globals first:
 *
 *   playwright-cli eval "() => { window.__AA_UPLOAD = 'assets/resume.pdf'; }"
 *   # optional, when several file inputs exist or to point at a specific one:
 *   playwright-cli eval "() => { window.__AA_UPLOAD_INDEX = 0; }"
 *   playwright-cli eval "() => { window.__AA_UPLOAD_TARGET = 'getByLabel(\"Resume\")'; }"
 *   playwright-cli run-code --filename=scripts/upload_file.js
 *
 * Returns JSON: { ok, attached, inputCount, value }. The path resolves relative to the
 * directory playwright-cli runs in (the project root); an absolute path is safest.
 */
async page => {
  const cfg = await page.evaluate(() => ({
    file: window.__AA_UPLOAD,
    target: window.__AA_UPLOAD_TARGET,
    index: Number(window.__AA_UPLOAD_INDEX || 0),
  }));
  if (!cfg.file)
    return { ok: false, error: "set window.__AA_UPLOAD to the file path first (playwright-cli eval ...)" };

  const allInputs = page.locator('input[type=file]');
  const inputCount = await allInputs.count();

  let input;
  if (cfg.target) {
    const t = page.locator(cfg.target);
    const isInput = await t.first()
      .evaluate(el => el.tagName === "INPUT" && el.type === "file").catch(() => false);
    input = isInput ? t.first() : t.locator('input[type=file]').first();
  } else {
    input = allInputs.nth(cfg.index);
  }

  if ((await input.count()) === 0)
    return { ok: false, error: "no matching file input found", inputCount };

  await input.setInputFiles(cfg.file);

  const value = await input.evaluate(el => {
    const f = el.files && el.files[0];
    return f ? `${f.name} (${f.size} bytes)` : "";
  }).catch(() => "");

  return { ok: !!value, attached: cfg.file, inputCount, value };
}
