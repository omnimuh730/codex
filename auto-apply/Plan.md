# Plan.md — Autonomous Job-Application Agent (Codex + playwright-cli)

> **Goal:** Given a job-application URL (Workday, Greenhouse, Lever, Ashby, iCIMS, etc.), the agent
> autonomously navigates the multi-step application, understands each field, fills it from a stored
> applicant profile, and submits — pausing for human approval at the final step by default.
>
> **Runtime agent:** Codex. Codex reads each page via `playwright-cli snapshot`, reasons about it,
> issues the next `playwright-cli` command, and repeats until the application is submitted.

---

## 0. How to read this document

You (Codex) are both the **builder** and the **runtime operator**.

- **Phases 1–4** build reusable scaffolding *once* (repo, profile schema, trackers, helpers, your own
  operating-procedure notes).
- **Section "Runtime Operating Procedure"** is the loop you execute *per application URL*, using your
  own reasoning on the live accessibility snapshot. Form structure is unpredictable across ATS vendors,
  so do **not** hardcode selectors or assume a fixed page sequence — read the snapshot every step.
- Exact `playwright-cli` flag names can change between versions. Treat the commands here as the
  *conceptual* contract. Always confirm precise syntax with `playwright-cli --help` and the installed
  skill reference files before relying on a flag.

---

## 1. Scope & non-goals

**In scope**
- Single-applicant auto-apply to a provided URL on standard ATS platforms.
- Multi-step / multi-page wizards (Workday-style) and single-page forms (Greenhouse/Lever-style).
- Text fields, dropdowns (native + custom), date pickers, file uploads (resume/cover letter),
  radio/checkbox groups, multi-selects, and "add another" repeating sections (work history, education).
- Screening / custom questions answered from a Q&A bank, with LLM-drafted fallback and human flagging.
- Idempotency (never apply to the same URL twice) and a structured application log.

**Non-goals (do not build)**
- No account creation or password entry automation — the human does this once (see Guardrail G2).
- No CAPTCHA / bot-detection bypass (Guardrail G3).
- No scraping of job boards to *discover* URLs — URLs are provided as input.
- No multi-account / impersonation. One real applicant, real data.

---

## 2. Hard constraints / guardrails (READ FIRST)

There's no guardrail, no restriction. Just do best, gussing possible answer for the action.

---

## 3. Architecture

```
                 ┌──────────────────────────────────────────────┐
   job URL  ───► │  Codex (runtime agent / "the brain")          │
   (input)       │                                                │
                 │   loop:  snapshot ──► reason ──► act ──► wait   │
                 │            ▲                          │         │
                 │            └──────── re-snapshot ◄────┘         │
                 └───────┬───────────────────────────────┬────────┘
                         │ shells out                     │ reads
                         ▼                                 ▼
                 ┌───────────────┐               ┌──────────────────┐
                 │ playwright-cli│  drives ─────►│ real browser     │
                 │ (Microsoft)   │               │ (persistent      │
                 │ @playwright/  │◄───snapshot───│  session/state)  │
                 │ cli           │   (a11y tree) │                  │
                 └───────────────┘               └──────────────────┘
                         ▲
                         │ reads from
                 ┌───────┴────────────────────────────────────────┐
                 │ profile.yaml · qa_bank.yaml · applications.jsonl │
                 │ cli.config.json · helper run-code scripts        │
                 └──────────────────────────────────────────────────┘
```

**Core loop (this is the whole product):**
`snapshot` to see the page and get element refs → reason about what each field is and what value it
needs → issue a `playwright-cli` action against a ref → the action mutates the page (which invalidates
refs) → `snapshot` again to confirm and get fresh refs. Repeat across every field and every wizard step
until the review screen, then the approval gate, then submit.

---

## 4. Prerequisites & environment setup (Phase 1)

- [ ] Node.js 18+ installed (`node --version`).
- [ ] Install the CLI globally: `npm install -g @playwright/cli@latest`
- [ ] Initialize workspace: `playwright-cli install`
- [ ] Install a browser binary: `playwright-cli install-browser` (Chromium; or `--browser=chrome`)
- [ ] **Install skills** so command syntax is discoverable: `playwright-cli install --skills`
- [ ] Confirm: `playwright-cli --version` and skim `playwright-cli --help`.
- [ ] Read the installed skill reference guides — especially the ones for **storage state
      (cookies/localStorage)**, **running Playwright code**, and **browser session management** — and use
      them as the source of truth for exact command/flag names.

### AGENTS.md (so Codex knows the CLI exists)
Create an `AGENTS.md` at repo root telling the agent:
- This project uses `@playwright/cli` (`playwright-cli`) for all browser actions.
- Always `playwright-cli --help` / consult installed skills for exact syntax.
- Always re-`snapshot` after any action that changes the page; refs are invalidated on page change.
- Obey every guardrail in `Plan.md §2`.

---

## 5. Repository structure (Phase 2)

```
auto-apply/
├── AGENTS.md                  # agent operating instructions (points here)
├── Plan.md                    # this file
├── config/
│   ├── cli.config.json        # → symlink/copy to .playwright/cli.config.json
│   ├── profile.yaml           # applicant data (single source of truth)
│   └── qa_bank.yaml           # known screening-question → answer pairs + defaults
├── assets/
│   ├── resume.pdf
│   └── cover_letter.md        # optional template; agent tailors per role
├── scripts/                   # helper run-code scripts (raw Playwright API)
│   ├── upload_file.js
│   ├── ensure_logged_in.js
│   └── wait_stable.js
├── runtime/
│   └── operating_procedure.md # the per-URL loop (Codex writes/uses this; mirrors §"Runtime")
├── logs/
│   ├── applications.jsonl     # one line per attempted application (dedup source)
│   └── runs/<timestamp>/       # per-run snapshots, screenshots, transcript
└── .playwright/
    └── cli.config.json        # auto-loaded by playwright-cli
```

---

## 6. Configuration & data schemas (Phase 2)

### `config/profile.yaml`
The agent fills forms **only** from this. Keep it truthful and complete.

```yaml
identity:
  first_name: "Jane"
  last_name: "Doe"
  preferred_name: "Jane"
  email: "jane.doe@example.com"
  phone: "+1-555-0100"
  location:
    city: "Austin"
    state: "TX"
    country: "United States"
    postal_code: "78701"
links:
  linkedin: "https://linkedin.com/in/janedoe"
  github: "https://github.com/janedoe"
  portfolio: "https://janedoe.dev"
documents:
  resume_path: "assets/resume.pdf"
  cover_letter_path: "assets/cover_letter.md"   # optional
work_authorization:
  authorized_to_work_us: true
  requires_sponsorship: false
preferences:
  desired_salary: null          # null => flag to human (G5), do not invent
  willing_to_relocate: true
  remote_preference: "hybrid"
  earliest_start_date: "2026-08-01"
experience:                      # used for "add another" repeating sections
  - company: "Acme Corp"
    title: "Senior Engineer"
    start: "2022-03"
    end: "present"
    location: "Remote"
    bullets:
      - "Led migration of X to Y, cutting latency 40%."
  - company: "Globex"
    title: "Engineer"
    start: "2019-06"
    end: "2022-02"
education:
  - school: "State University"
    degree: "B.S."
    field: "Computer Science"
    start: "2015"
    end: "2019"
# Sensitive — leave as `decline` unless you intentionally set real values (G4).
voluntary_self_id:
  gender: "decline"
  race_ethnicity: "decline"
  veteran_status: "decline"
  disability_status: "decline"
```

### `config/qa_bank.yaml`
Known screening questions and reusable defaults. Match incoming questions against `patterns`
(case-insensitive substring or regex). On no match → LLM drafts from profile context; if low confidence
or high-stakes → flag (G5).

```yaml
defaults:
  notice_period: "2 weeks"
  why_company: "TEMPLATE: tailor per role from job description on the page."
qa:
  - patterns: ["years of experience", "how many years"]
    answer_strategy: "compute_from_profile.experience"
  - patterns: ["authorized to work", "legally authorized"]
    answer_strategy: "profile.work_authorization.authorized_to_work_us"
  - patterns: ["require sponsorship", "visa sponsorship"]
    answer_strategy: "profile.work_authorization.requires_sponsorship"
  - patterns: ["expected salary", "salary expectation", "desired compensation"]
    answer_strategy: "flag_human"     # G5
  - patterns: ["how did you hear"]
    answer: "Company website"
```

### `config/cli.config.json` → `.playwright/cli.config.json`
Auto-loaded by the CLI. Set browser/headed/timeouts/pacing here instead of repeating flags.

```json
{
  "headed": true,
  "browser": "chromium",
  "timeouts": { "default": 30000, "navigation": 45000 },
  "viewport": { "width": 1440, "height": 900 }
}
```

### `logs/applications.jsonl` (dedup + audit)
One JSON object per attempt:
```json
{"ts":"2026-06-17T10:00:00Z","url":"https://...","company":"Acme","role":"SWE","status":"submitted|review_pending|flagged|skipped_duplicate|stopped_captcha|error","fields_flagged":[],"run_dir":"logs/runs/20260617-100000"}
```
Before applying to any URL, scan this file; if the URL is already present with status `submitted` or
`review_pending`, skip (status `skipped_duplicate`) unless `--force`.

---

## 7. Build phases (checklist)

- [ ] **Phase 1 — Environment** (§4): install CLI + browser + skills, write `AGENTS.md`.
- [ ] **Phase 2 — Scaffolding** (§5, §6): repo layout, `profile.yaml`, `qa_bank.yaml`, `cli.config.json`,
      empty `applications.jsonl`, `logs/runs/`.
- [ ] **Phase 3 — Helper scripts** (§9): `upload_file.js`, `ensure_logged_in.js`, `wait_stable.js`
      using `playwright-cli run-code`. Confirm each works in isolation against a test page.
- [ ] **Phase 4 — Operating procedure** (§"Runtime"): write `runtime/operating_procedure.md` so future
      runs are consistent. This is your own checklist for the per-URL loop.
- [ ] **Phase 5 — Dry run on a Greenhouse/Lever single-page form** with `auto_submit:false`. Verify it
      fills correctly and stops at the review gate. Do not submit.
- [ ] **Phase 6 — Dry run on a Workday multi-step form.** Verify multi-page navigation, login handoff
      (G2), repeating sections, and the review gate.
- [ ] **Phase 7 — Acceptance** (§12): run the acceptance checklist; only then consider `auto_submit:true`.

---

## 8. Runtime Operating Procedure (the per-URL loop)

> Input: a job-application URL (+ optional `--auto-submit`, `--force`).
> Execute these steps in order. **Re-snapshot after every action that changes the page.**

**R0. Pre-flight.**
- Dedup check against `applications.jsonl` (§6). If duplicate and not `--force` → log `skipped_duplicate`,
  stop.
- Create `logs/runs/<timestamp>/` for snapshots/screenshots/transcript.
- Load `profile.yaml` + `qa_bank.yaml`.

**R1. Open the page.**
- `playwright-cli open <url>` (headed per config).
- `playwright-cli snapshot` → read the accessibility tree, capture the company/role from headings if
  present (for logging + cover-letter tailoring).

**R2. Auth check (G2).**
- If the snapshot shows a login/sign-in/create-account gate (look for `textbox "Password"`,
  "Sign in", "Create account"): run `scripts/ensure_logged_in.js` to detect/restore a saved session.
  If still not authenticated, print a clear instruction, leave the browser open, and **wait for the human
  to log in manually**, then persist storage state and continue. Never type a password yourself.

**R3. Reach the application form.**
- Some pages have an "Apply" / "Apply for this job" button before the form. Find it in the snapshot and
  `click` its ref, then re-`snapshot`.

**R4. Per-page fill loop** (repeat for every wizard step):
1. `snapshot` the current step.
2. Enumerate every fillable element from the tree (textbox, combobox, listbox, radio, checkbox,
   button-with-`[expanded]`, file input, date field). Note each element's role, accessible name, current
   state, and `ref`.
3. For each field, decide its value using the **Field-Handling Playbook (§9)** and the profile/Q&A bank.
   - If a value can't be determined or is high-stakes/low-confidence → record it in `fields_flagged` and
     (per G5) pause for the human at the end of this step rather than guessing.
4. Apply each value with the appropriate command (§9). After any action that re-renders (custom
   dropdowns, "add another", conditional fields), **re-snapshot** before touching the next element.
5. Handle file uploads via `scripts/upload_file.js` (§9).
6. Detect the step's "Next"/"Continue"/"Save and Continue" control; `click` it; `wait` for the next step
   to load (wait on a stable condition — heading text changes, spinner gone — do **not** tight-poll).
7. Re-`snapshot`. If the new page is another form step → repeat R4. If it's a CAPTCHA → R6. If it's the
   review/summary screen → R5.

**R5. Review gate (G1).**
- On the final review/summary screen: `snapshot` + `screenshot` it into the run dir.
- Print a concise field-by-field summary of what will be submitted, plus the contents of
  `fields_flagged`.
- If any flagged fields remain unresolved, or `auto_submit` is false → **stop and request explicit human
  confirmation.** Log `review_pending`. Do not click submit.
- Only proceed to R7 when (a) the human explicitly approves, or (b) `auto_submit:true` AND no unresolved
  flags.

**R6. Bot-detection handoff (G3).**
- Screenshot, log `stopped_captcha`, hand back to the human with URL + current step. Do not attempt to
  solve.

**R7. Submit.**
- Find the final Submit/Apply control, confirm via its accessible name it's the real submit (not "Save
  draft"), `click` it.
- `wait` for and `snapshot` the confirmation page; verify success semantically (look for a
  `heading`/`alert` like "Application submitted" / "Thank you for applying"). Screenshot it.
- Log `submitted` with the run dir.

**R8. Close out.**
- Append the final record to `applications.jsonl`. Save the full command transcript to the run dir.

---

## 9. Field-Handling Playbook

Use the accessibility role to choose the technique. Always act on the `ref` from the latest snapshot.

| Field type (snapshot signal) | Technique |
|---|---|
| `textbox "..."` | `playwright-cli type <ref> "value"`. For multi-line, type with `\n` or use `run-code` if needed. |
| `combobox` with `option` children (native `<select>`) | use the CLI's select-option command on `<ref>` with the option label. Confirm exact command via `--help`/skills. |
| `button "..." [expanded=false]` (custom dropdown) | `click <ref>` → **re-snapshot** → the options now appear as a `listbox`/`option` set → `click` the desired option's new ref. |
| date picker | Prefer typing an ISO/locale date into the underlying `textbox` if present. If it's a calendar widget only, use `run-code` with `page.fill`/`locator` per the storage/running-code skill. |
| `radio` group | `click` the ref of the matching option only. |
| `checkbox` | `click` to toggle; verify resulting `[checked]` state in the next snapshot. |
| multi-select / tag input | Often type-then-select: `type` partial text → re-snapshot → `click` the surfaced option; repeat per value. |
| **file upload** (`button "Upload"` / hidden file input) | Run `scripts/upload_file.js` which uses `setInputFiles` on the input via `run-code`. Native upload command may exist — check `--help` first. |
| "Add another" repeating section (experience/education) | `click` the add control → re-snapshot → fill the newly revealed fields → repeat per `profile.experience[]` / `profile.education[]`. |
| EEO / voluntary self-ID | Per **G4**: choose the decline/prefer-not-to-answer option unless `profile.voluntary_self_id` sets a real value. |
| screening question (`textbox`/`combobox` with a prompt) | Resolve via `qa_bank` match → else LLM-draft from profile + on-page job description → else **flag** (G5). Never fabricate (G7). |

### Helper scripts (`scripts/`, via `playwright-cli run-code`)
`run-code` exposes the full Playwright API (`page`, `context`) — this is the escape hatch for anything
the simple verbs can't express. Confirm the exact `run-code` invocation against the installed skill.

- **`upload_file.js`** — locate the file input (by `aria-ref`/label) and call
  `locator.setInputFiles(absolutePath)`; verify the filename appears in the next snapshot.
- **`ensure_logged_in.js`** — check for an authenticated marker; if absent, restore saved storage state;
  if still unauthenticated, return a "needs manual login" signal (drives G2 handoff). Persist storage
  state after the human logs in.
- **`wait_stable.js`** — smart wait that ignores analytics/spinners and resolves when the step's primary
  content is present (used between wizard steps instead of fixed sleeps / tight polling).

---

## 10. Error handling & resilience

- **Stale refs** are the #1 failure mode. Treat *every* page mutation (navigation, custom-dropdown open,
  "add another", conditional reveal, validation re-render) as ref-invalidating → re-snapshot before the
  next action.
- **Async content** → wait on a semantic condition (text appears / spinner text gone / element present),
  never a tight snapshot loop and never a blind fixed sleep as the primary mechanism.
- **Validation errors** → after clicking Next, snapshot for `alert`/error roles tied to fields; if found,
  correct the offending field and retry that step (max N retries, configurable) before flagging.
- **Unexpected page / dead end** → screenshot, log `error` with the last good snapshot, stop gracefully.
- **Session expiry mid-flow** → if an auth gate reappears, trigger the G2 handoff rather than failing.
- **Idempotency** → if a run crashes after submit but before logging, the confirmation-page check in R7
  plus the dedup scan prevents accidental double-submission on rerun.

---

## 11. Logging & observability

- Per run, save: the ordered command transcript, every snapshot (numbered), and key screenshots
  (each wizard step + review + confirmation) under `logs/runs/<timestamp>/`.
- `applications.jsonl` is the durable audit + dedup source.
- Optionally use `playwright-cli show` (the live session dashboard) while developing to watch the agent
  drive the browser.

---

## 12. Testing & acceptance criteria

Run with `auto_submit:false` throughout testing. **Do not submit real applications during tests** — use
your own throwaway/test postings or stop at the review gate.

- [ ] Greenhouse/Lever single-page form: all standard fields filled correctly from profile; resume
      uploaded; stops cleanly at review gate with an accurate summary.
- [ ] Workday multi-step form: navigates ≥3 steps; login handoff (G2) works; ≥1 "add another" repeating
      section filled from `profile.experience`; review gate reached.
- [ ] Custom dropdown handled (open → re-snapshot → select).
- [ ] EEO section defaults to decline (G4).
- [ ] A salary/work-auth question is **flagged**, not guessed (G5).
- [ ] A CAPTCHA page triggers the G3 handoff (test on any page that shows one).
- [ ] Re-running the same URL is skipped as duplicate (G + §6).
- [ ] No password is ever typed by the agent; no account is created by the agent (G2).

**Definition of done:** all acceptance boxes pass; the agent completes a full Workday flow up to the
review gate unattended; submission only ever occurs via the approval gate or an explicit `auto_submit`
opt-in.

---

## 13. Commands quick reference (verify exact flags with `playwright-cli --help` / skills)

```bash
# setup
npm install -g @playwright/cli@latest
playwright-cli install
playwright-cli install-browser
playwright-cli install --skills

# the loop
playwright-cli open <url>                 # navigate (headed via config)
playwright-cli snapshot                    # read a11y tree + refs  (re-run after every change)
playwright-cli click <ref>
playwright-cli type <ref> "text"
playwright-cli press Enter
# select option on a native <select>  -> confirm command name via --help
playwright-cli wait --text "Application submitted"
playwright-cli wait --text-gone "Loading"
playwright-cli screenshot
playwright-cli run-code "<playwright js>"  # uploads, custom waits, multi-tab, reading state
playwright-cli run-code --filename=scripts/upload_file.js
playwright-cli show                        # live session dashboard (dev)
```

---

## 14. Operating reminders for the agent (pin these)

1. Read the snapshot before every decision; re-snapshot after every page change. Refs die on change.
2. Fill only from `profile.yaml` / `qa_bank.yaml`. Never fabricate (G7).
3. Sensitive/self-ID → decline by default (G4). High-stakes/uncertain → flag, don't guess (G5).
4. Never type passwords or create accounts — hand login to the human (G2).
5. Never solve CAPTCHAs — hand off (G3).
6. Never click the final submit without approval, unless `auto_submit:true` and zero unresolved flags (G1).
7. One application at a time, with human-like pacing (G6).
8. Confirm exact CLI syntax via `playwright-cli --help` and installed skills — don't assume flags.