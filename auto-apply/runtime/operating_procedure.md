# Runtime Operating Procedure — the per-URL loop

> You are the runtime operator. Execute these steps in order for **one** application URL.
> Read [`../AGENTS.md`](../AGENTS.md) for the command cheat-sheet and [`../Plan.md`](../Plan.md)
> for the design. **The cardinal rule: read the snapshot, then drive the page with ONE plain
> `playwright-cli` verb per step — AI reasoning + playwright-cli only, no custom scripts or
> hardcoded selectors. Re-snapshot after an action that mutates the page. NEVER probe DOM/React
> internals to verify a value — read it from one snapshot. Snapshot to a FILE and `grep` it;
> never dump a full snapshot into the conversation.**
>
> All commands below were verified against `playwright-cli` v0.1.x. Confirm with
> `playwright-cli --help` if your version differs. Run everything from the project root
> (`auto-apply/`) so relative paths (`assets/…`, `scripts/…`) resolve.

Inputs: `<url>` (required), `--auto-submit` (optional), `--force` (optional).

---

## R0 — Pre-flight

```bash
scripts/preflight.sh "<url>"            # add --force to override a duplicate
```
- Exit `10` + `DUP=yes` → already applied. Log `skipped_duplicate` and STOP (unless `--force`).
- Capture `RUN_DIR=logs/runs/<timestamp>` from the output; put all snapshots/screenshots there.
- Load `config/profile.yaml` + `config/qa_bank.yaml` into your working memory.
- Read `agent.auto_submit` (and the other `agent.*` settings) from `config/cli.config.json`.

## R1 — Open the page

```bash
playwright-cli open "<url>"                       # headed, chromium, 1440x900 via config
playwright-cli snapshot --filename=$RUN_DIR/01-landing.yml
```
> `open` auto-loads `.playwright/cli.config.json` when run from the project root (verified).
> The settings only apply to a **freshly launched** session — if a stale daemon is running
> with the wrong settings, `playwright-cli close-all && playwright-cli kill-all` first. If
> `open <url>` ever lands on `about:blank`, follow with `playwright-cli goto "<url>"`.

From the snapshot, capture the **company** and **role** from the top headings (for logging +
cover-letter tailoring).

## R2 — Auth check (G2)

```bash
playwright-cli state-load .playwright/auth-state.json 2>/dev/null   # restore a prior session if present
playwright-cli run-code --filename=scripts/ensure_logged_in.js
```
- `needsManualLogin: true` → print a clear instruction, leave the browser open, and **wait for
  the human to log in manually**. NEVER type a password or create an account. Once they confirm:
  ```bash
  playwright-cli state-save .playwright/auth-state.json
  ```
  then continue.
- `authenticated: true` → continue.

## R3 — Reach the application form

Some pages gate the form behind an "Apply" / "Apply for this job" button. Find it in the
snapshot and click it, then re-snapshot.
```bash
playwright-cli click <ref-of-apply-button>
playwright-cli run-code --filename=scripts/wait_stable.js
playwright-cli snapshot --filename=$RUN_DIR/02-form.yml
```

## R4 — Per-page fill loop  (repeat for every wizard step)

1. **Snapshot to a file, read compactly.** `playwright-cli snapshot --filename=$RUN_DIR/NN-step.yml --depth=12`,
   then `grep -nE '(textbox|combobox|listbox|radio|checkbox|button|ref=)' $RUN_DIR/NN-step.yml`.
   Never `cat` the whole snapshot into the conversation.
2. **Enumerate** the fillable elements from that grep — role, accessible name, current state, `ref`.
3. **Decide** each value with the Field-Handling Playbook + `profile.yaml` / `qa_bank.yaml`.
   If a value can't be determined or is high-stakes/low-confidence → add `{name, why}` to
   `fields_flagged`; do NOT guess.
4. **Apply** each value with ONE plain playwright-cli verb (`fill` / `select` / `check` / `click`),
   one step at a time:
   - **Native** `textbox` → `fill <ref> "value"`; native `<select>` → `select <ref> "label"`;
     `checkbox`/`radio` → `check <ref>` / `click <ref>`.
   - **Custom combobox** (React-Select etc., value not in `.value`) → `click <ref>` → `type "option text"`
     → re-snapshot → `click` the option's fresh ref. Plain verbs only.
   After an action that re-renders, re-snapshot before the next ref (it may have moved).
5. **Uploads**: prefer native — `playwright-cli click <upload-ref>` then
   `playwright-cli upload assets/resume.pdf`. Hidden input → `scripts/upload_file.js`.
6. **Verify from the snapshot, not the DOM.** Re-snapshot (to file) and confirm each field shows
   its value in the accessibility tree. **Do NOT `run-code` to inspect `outerHTML`/React props/
   hidden inputs/CSS classes** — that is the biggest waste; trust the snapshot. Run
   `scripts/detect_errors.js` for validation errors; fix only the offenders (retry up to
   `agent.max_step_retries`), else flag.
7. **Advance**: `click` "Next"/"Continue"/"Submit", then `scripts/wait_stable.js`. Do not blind-`sleep`
   or tight-poll `snapshot`. Another form step → repeat R4. CAPTCHA → R6. Review screen → R5.

## R5 — Review gate (G1)

```bash
playwright-cli snapshot --filename=$RUN_DIR/review.yml
playwright-cli screenshot --filename=$RUN_DIR/review.png
```
- Print a concise **field-by-field summary** of what will be submitted, plus everything in
  `fields_flagged`.
- If any flagged field is unresolved, OR `agent.auto_submit` is `false` → **STOP and request
  explicit human confirmation.** Append a `review_pending` record to `applications.jsonl`.
  Do not click Submit.
- Proceed to R7 only when (a) the human explicitly approves, or (b) `auto_submit: true` AND
  zero unresolved flags.

## R6 — Bot-detection handoff (G3)

CAPTCHA / "verify you are human": `playwright-cli screenshot --filename=$RUN_DIR/captcha.png`,
log `stopped_captcha` with the URL + current step, hand back to the human. Do not attempt to solve.

## R7 — Submit

```bash
# confirm via accessible name it's the REAL submit, not "Save draft"
playwright-cli click <ref-of-submit>
playwright-cli run-code "async page => page.getByText('submitted', {exact:false}).first().waitFor({timeout:30000})"
playwright-cli snapshot --filename=$RUN_DIR/confirmation.yml
playwright-cli screenshot --filename=$RUN_DIR/confirmation.png
```
Verify success **semantically** — look for a `heading`/`alert` like "Application submitted" /
"Thank you for applying". Only then treat it as submitted.

## R8 — Close out

- Append the final record to `logs/applications.jsonl` (schema below).
- Save the ordered command transcript to `$RUN_DIR/transcript.md`.
- `playwright-cli close`.

```json
{"ts":"2026-06-17T10:00:00Z","url":"https://…","company":"Acme","role":"SWE","status":"submitted|review_pending|flagged|skipped_duplicate|stopped_captcha|error","fields_flagged":[],"run_dir":"logs/runs/20260617-100000"}
```

---

## Field-Handling Playbook (snapshot signal → technique)

| Field (snapshot signal) | Technique |
|---|---|
| `textbox "..."` | `playwright-cli fill <ref> "value"` (clears first). Multi-line: `fill` with `\n`, or `type`. |
| `combobox` with `option` children (native `<select>`) | `playwright-cli select <ref> "Option label or value"`. |
| `button "..." [expanded=false]` (custom dropdown) | `click <ref>` → **re-snapshot** → options appear as a `listbox`/`option` set → `click` the desired option's new ref. |
| date picker | Prefer typing ISO/locale date into the underlying `textbox` (`fill`). Calendar-only widget → `run-code` with `page.fill`/`locator`. |
| `radio` group | `click` (or `check`) the ref of the matching option only. |
| `checkbox` | `playwright-cli check <ref>` / `uncheck <ref>`; verify `[checked]` in the next snapshot. |
| multi-select / tag input | `fill`/`type` partial text → re-snapshot → `click` the surfaced option; repeat per value. |
| **file upload** | Native: `click <upload-ref>` → `playwright-cli upload assets/resume.pdf`. Hidden input: `scripts/upload_file.js`. |
| "Add another" repeating section | `click` the add control → re-snapshot → fill the newly revealed fields → repeat per `profile.experience[]` / `profile.education[]`. |
| EEO / voluntary self-ID | Choose decline / prefer-not-to-answer unless `profile.voluntary_self_id` sets a real value (G4). |
| screening question (`textbox`/`combobox` with a prompt) | Match against `qa_bank.yaml` → else draft from profile + on-page job description → else **flag** (G5). Never fabricate. |

## qa_bank resolution

For each screening question, lowercase it and test against each `qa[].patterns` (substring or
regex), first match wins:
- `answer:` literal → use verbatim.
- `answer_strategy: profile.<path>` → read from `profile.yaml`; booleans → "Yes"/"No"; for a
  combobox pick the option whose label best matches the value.
- `answer_strategy: compute_from_profile.experience` → total years across `experience[]`.
- `answer_strategy: flag_human` → add to `fields_flagged`, never guess.
- No match → draft from profile + the job description on the page; if low-confidence or
  high-stakes → flag.

## Error handling (see Plan.md §10)

- **Stale refs** are the #1 failure mode → re-snapshot after every mutation.
- **Async content** → `scripts/wait_stable.js` or a semantic `waitFor`; never a blind sleep.
- **Validation errors** → correct + retry the step up to `max_step_retries`, then flag.
- **Unexpected page / dead end** → screenshot, log `error` with the last good snapshot, stop.
- **Session expiry mid-flow** → an auth gate reappears → re-run R2 (G2 handoff).
- **Idempotency** → the R7 confirmation check + the R0 dedup scan prevent double-submission.
