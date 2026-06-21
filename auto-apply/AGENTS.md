# AGENTS.md — Autonomous Job-Application Agent

This project auto-applies to a provided job-application URL (Workday, Greenhouse, Lever,
Ashby, iCIMS, …). The runtime agent reads each page's accessibility snapshot, reasons about
each field, fills it from a stored applicant profile, and submits — pausing for human
approval at the final step by default.

**Read [`Plan.md`](Plan.md) for the full design. Read
[`runtime/operating_procedure.md`](runtime/operating_procedure.md) for the per-URL loop you
execute every run.**

---

## The one rule that matters

**Read the snapshot before every decision. Re-snapshot after every action that changes the
page.** Element refs (`e15`, `e3`, …) are invalidated by *any* page mutation — navigation, a
custom dropdown opening, an "add another" reveal, a conditional field, a validation
re-render. Acting on a stale ref hits the wrong element. When in doubt, `snapshot` again.

Form structure is unpredictable across ATS vendors, so **do not hardcode selectors or assume
a fixed page sequence** — read the live snapshot every step.

---

## The tool: `playwright-cli`

All browser actions go through `@playwright/cli` (the `playwright-cli` command). It is
installed globally. Confirm it: `playwright-cli --version`.

> The exact flag names can change between versions. **Always confirm syntax with
> `playwright-cli --help` and the installed skill** before relying on a flag. The installed
> skill reference lives at the path printed by `playwright-cli --help` (the
> `cli-client/skill/SKILL.md` + its `references/` guides). The guides that matter most here:
> `running-code.md`, `storage-state.md`, `session-management.md`.

### Commands this project actually uses

| Need | Command (verified against v0.1.x) |
|---|---|
| Open browser at a URL | `playwright-cli open <url>` |
| Navigate an open browser | `playwright-cli goto <url>` |
| **Read the page + get refs** | `playwright-cli snapshot` (optionally `--filename=…`, `--depth=N`) |
| Click an element | `playwright-cli click <ref>` |
| Type into the focused editable element | `playwright-cli type "text"` |
| Fill a specific field (clears first) | `playwright-cli fill <ref> "text"` (add `--submit` to press Enter) |
| Native `<select>` dropdown | `playwright-cli select <ref> "Option label or value"` |
| Checkbox / radio | `playwright-cli check <ref>` / `playwright-cli uncheck <ref>` |
| Press a key | `playwright-cli press Enter` (also `ArrowDown`, `Tab`, …) |
| **File upload** | `playwright-cli upload <file>` (native file-chooser) — or `run-code` + `setInputFiles` for hidden inputs (see `scripts/upload_file.js`) |
| Screenshot | `playwright-cli screenshot --filename=…` |
| Read an attribute not in the snapshot | `playwright-cli eval "el => el.getAttribute('aria-label')" <ref>` |
| **Run arbitrary Playwright code** | `playwright-cli run-code "async page => { … }"` or `run-code --filename=scripts/x.js` |
| Save / restore login state | `playwright-cli state-save <file>` / `playwright-cli state-load <file>` |
| Live dashboard (dev) | `playwright-cli show` |
| List / close sessions | `playwright-cli list` / `playwright-cli close` / `playwright-cli close-all` |

Notes:
- There is **no `wait --text` verb** in this CLI version. Wait by running
  `scripts/wait_stable.js` via `run-code`, or `run-code "async page => page.getByText('…').waitFor()"`.
  Never use a blind fixed `sleep` as the primary wait, and never tight-poll `snapshot`.
- `run-code` takes a **single function expression** `async page => { … }`; it is wrapped in
  `(...)` and evaluated. `import`/`require` are not supported. It can `return` a JSON-able value.
- Add `--raw` to strip status/snapshot wrapping (handy for piping `eval`/`snapshot` output).
- Refs are also addressable by CSS / role / testid, e.g.
  `playwright-cli click "getByRole('button', { name: 'Submit' })"` — useful when a ref just
  went stale but you know the accessible name.

### Config

Browser settings live under the **`browser`** key (Playwright-MCP schema:
`browser.browserName`, `browser.launchOptions.headless`, `browser.contextOptions.viewport`)
— *not* flat `headed`/`viewport` keys. `playwright-cli open` auto-loads
`.playwright/cli.config.json` when run from the project root (verified: headed chromium at
1440×900); `config/cli.config.json` is the editable source copy. Settings apply only to a
**freshly launched** session, so `close-all && kill-all` before changing them. The custom
`agent` block is read by this project's runtime, not by the CLI (which ignores unknown keys).

---

## Data sources (fill forms ONLY from these)

- [`config/profile.yaml`](config/profile.yaml) — the single source of truth for applicant data.
- [`config/qa_bank.yaml`](config/qa_bank.yaml) — known screening-question → answer pairs + defaults.
- [`assets/`](assets/) — `resume.pdf`, optional `cover_letter.md` template.
- [`logs/applications.jsonl`](logs/applications.jsonl) — dedup + audit log (one line per attempt).

Do not invent data that is not in the profile/Q&A bank. When a value can't be determined or
is high-stakes (salary, anything legally significant), record it in `fields_flagged` and
surface it to the human at the review gate rather than guessing.

---

## Behavior the human controls

`Plan.md §2` removes hard guardrails; the safe defaults below are kept as **configurable
behavior**, not hard blocks, and live in `config/cli.config.json → agent`:

1. **Review gate** (`agent.auto_submit`, default `false`): stop at the final review screen,
   print a field-by-field summary, and wait for explicit human approval before clicking the
   real Submit. Set `auto_submit: true` to submit automatically when there are zero
   unresolved flags.
2. **Login handoff** (`agent.handle_login`): never type a password or create an account.
   On an auth gate, restore saved state if possible; otherwise leave the browser open and
   ask the human to log in, then `state-save`.
3. **EEO / voluntary self-ID**: choose decline / prefer-not-to-answer unless
   `profile.voluntary_self_id` sets a real value.
4. **CAPTCHA / bot-detection**: do not attempt to solve; screenshot, log `stopped_captcha`,
   hand back to the human.
5. **Idempotency**: never apply to the same URL twice — `scripts/preflight.sh` checks
   `logs/applications.jsonl` before each run (override with `--force`).

---

## Per-run workflow (summary — full version in `runtime/operating_procedure.md`)

`preflight (dedup + run dir)` → `open` → `snapshot` → handle any auth/Apply gate →
**per-step fill loop** (`snapshot` → enumerate fields → decide values from profile/Q&A →
act on refs → re-`snapshot`) → review gate → submit (gated) → log to `applications.jsonl`.
