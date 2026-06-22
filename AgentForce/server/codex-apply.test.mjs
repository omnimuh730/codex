import test from "node:test";
import assert from "node:assert/strict";

import { buildApplyPrompt, buildResumePrompt, parseResult, usageToAgentForce } from "./codex-apply.mjs";

test("buildApplyPrompt includes job + profile and omits secrets", () => {
  const prompt = buildApplyPrompt({
    url: "https://jobs.example.com/apply/123",
    job: { title: "Backend Engineer", company: "Acme" },
    profile: { fullName: "Eli Taylor", email: "eli@example.com", deepseekApiKey: "sk-secret", openaiApiKey: "sk-secret2", gmailAppPassword: "pw" },
    resumePath: "/resumes/eli.pdf",
    autoSubmit: true,
  });
  assert.match(prompt, /jobs\.example\.com\/apply\/123/);
  assert.match(prompt, /Backend Engineer at Acme/);
  assert.match(prompt, /Eli Taylor/);
  assert.match(prompt, /\/resumes\/eli\.pdf/);
  assert.match(prompt, /CLICK the real Submit button/);
  assert.match(prompt, /HUMAN HANDOFF/);
  assert.match(prompt, /RESULT: <submitted\|review_pending\|skipped\|paused\|error>/);
  // secrets stripped
  assert.doesNotMatch(prompt, /sk-secret/);
  assert.doesNotMatch(prompt, /gmailAppPassword/);
});

test("buildApplyPrompt honors the review-gate (autoSubmit=false)", () => {
  const prompt = buildApplyPrompt({ url: "u", job: {}, profile: { fullName: "X" }, resumePath: "", autoSubmit: false });
  assert.match(prompt, /STOP at the final review screen/);
  assert.doesNotMatch(prompt, /SUBMIT the application/);
});

test("parseResult recognizes paused (human handoff)", () => {
  assert.deepEqual(parseResult("RESULT: paused — solve the hCaptcha on the login screen"), {
    result: "paused",
    message: "solve the hCaptcha on the login screen",
  });
});

test("buildResumePrompt forbids preflight/close and continues from current page", () => {
  const p = buildResumePrompt({ note: "Human solved the CAPTCHA.", autoSubmit: true });
  assert.match(p, /Human solved the CAPTCHA\./);
  assert.match(p, /Do NOT run preflight, close-all, kill-all/);
  assert.match(p, /snapshot/i);
  assert.match(p, /CLICK the real Submit button/);
});

test("parseResult extracts status + reason from the RESULT line", () => {
  assert.deepEqual(parseResult("...\nRESULT: submitted — Application received, ref #42"), {
    result: "submitted",
    message: "Application received, ref #42",
  });
  assert.deepEqual(parseResult("RESULT: needs_login - account required").result, "needs_login");
  assert.equal(parseResult("RESULT: skipped").result, "skipped");
  // no RESULT line → unconfirmed fallback
  assert.equal(parseResult("done but no marker").result, "submitted_unconfirmed");
});

test("usageToAgentForce maps codex usage to dashboard usage + cost", () => {
  // deepseek-v4-flash: miss $0.14 / hit $0.0028 / output $0.28 per 1M
  const u = usageToAgentForce("deepseek-v4-flash", {
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    output_tokens: 1_000_000,
  });
  assert.equal(u.inputTokens, 1_000_000);
  assert.equal(u.outputTokens, 1_000_000);
  assert.ok(u.priced);
  // 0.14 + 0.28 = 0.42
  assert.ok(Math.abs(u.costUsd - 0.42) < 1e-9, `costUsd=${u.costUsd}`);
  assert.match(u.costLabel, /^\$/);
});
