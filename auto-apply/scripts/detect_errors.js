/*
 * detect_errors.js — after a submit attempt, find validation errors so the agent can
 * re-plan and fix the offending fields. Returns { errors: string[], bodyHas: boolean }.
 *   playwright-cli run-code --filename=scripts/detect_errors.js
 */
async page => {
  return await page.evaluate(() => {
    const errs = new Set();

    // Fields the form marked invalid → use their accessible label / question.
    for (const f of document.querySelectorAll('[aria-invalid=true], [aria-invalid="true"]')) {
      let lbl = f.getAttribute("aria-label") || "";
      if (!lbl && f.id) { const l = document.querySelector('label[for="' + f.id + '"]'); if (l) lbl = l.innerText; }
      if (!lbl) { const l = f.closest("label"); if (l) lbl = l.innerText; }
      lbl = (lbl || "").replace(/\s+/g, " ").trim();
      if (lbl) errs.add(lbl.slice(0, 160));
    }

    // Explicit "required field" / "missing entry" messages (question follows the colon).
    const body = document.body.innerText || "";
    for (const m of body.matchAll(/(?:missing entry for required field|required field|this field is required)[:\s-]*([A-Za-z][^\n]{4,160})/gi)) {
      errs.add((m[1] || "").replace(/\s+/g, " ").trim());
    }

    const bodyHas = /your form needs correction|needs correction|required field|this field is required|please (?:fill|complete|answer|select)|missing entry|cannot be blank|\bis required\b/i.test(body);
    return { errors: [...errs].filter(Boolean).slice(0, 25), bodyHas };
  });
}
