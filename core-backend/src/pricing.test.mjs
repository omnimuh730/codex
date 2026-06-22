import test from "node:test";
import assert from "node:assert/strict";

import { costFromUsage, parsePromptUsage, usageDelta, mergeUsage } from "./pricing.mjs";

function approx(actual, expected, tol = 0.002) {
  assert.ok(Math.abs(actual - expected) < tol, `expected ~${expected}, got ${actual}`);
}

test("parsePromptUsage prefers DeepSeek explicit hit/miss fields", () => {
  const u = parsePromptUsage({
    prompt_tokens: 999,
    prompt_cache_hit_tokens: 800,
    prompt_cache_miss_tokens: 199,
    completion_tokens: 50,
    total_tokens: 1049,
  });
  assert.equal(u.cacheHit, 800);
  assert.equal(u.cacheMiss, 199);
  assert.equal(u.outputTokens, 50);
});

test("parsePromptUsage derives miss from prompt_tokens - hit when miss omitted", () => {
  const u = parsePromptUsage({
    prompt_tokens: 1000,
    prompt_cache_hit_tokens: 700,
    completion_tokens: 100,
  });
  assert.equal(u.cacheHit, 700);
  assert.equal(u.cacheMiss, 300);
});

test("parsePromptUsage handles codex-rs shape (input_tokens + cached_input_tokens)", () => {
  const u = parsePromptUsage({
    input_tokens: 1_000_000,
    cached_input_tokens: 900_000,
    output_tokens: 50_000,
    total_tokens: 1_050_000,
  });
  assert.equal(u.cacheHit, 900_000);
  assert.equal(u.cacheMiss, 100_000);
  assert.equal(u.outputTokens, 50_000);
});

test("deepseek-v4-flash — Jun-22 console day", () => {
  const u = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 16_545_664,
    prompt_cache_miss_tokens: 206_801,
    completion_tokens: 102_043,
    total_tokens: 16_854_508,
  });
  assert.equal(u.inputTokens, 206_801);
  assert.equal(u.cachedTokens, 16_545_664);
  approx(u.costUsd, 0.104);
});

test("deepseek-v4-flash — 3-day console sum ~$0.57", () => {
  const u = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 80_346_112,
    prompt_cache_miss_tokens: 1_077_327,
    completion_tokens: 696_925,
  });
  approx(u.costUsd, 0.571);
});

test("deepseek-v4-flash — Affirm job from logs ~$0.064 not $1.07", () => {
  const u = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 14_424_448,
    prompt_cache_miss_tokens: 106_727,
    completion_tokens: 31_369,
  });
  approx(u.costUsd, 0.064, 0.005);
  assert.ok(u.costUsd < 0.15, "must be well below old wrong ~$1.07 estimate");
});

test("deepseek-v4-flash — zero cache hit (miss-only baseline)", () => {
  const u = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 100_000,
    completion_tokens: 10_000,
  });
  approx(u.costUsd, (100_000 * 0.14 + 10_000 * 0.28) / 1_000_000);
});

test("deepseek-v4-pro spot check", () => {
  const u = costFromUsage("deepseek-v4-pro", {
    prompt_cache_hit_tokens: 1_000_000,
    prompt_cache_miss_tokens: 100_000,
    completion_tokens: 50_000,
  });
  const expected = (100_000 * 0.435 + 1_000_000 * 0.003625 + 50_000 * 0.87) / 1_000_000;
  approx(u.costUsd, expected, 0.0001);
});

test("usageDelta subtracts cumulative resume totals", () => {
  const prev = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 500_000,
    prompt_cache_miss_tokens: 10_000,
    completion_tokens: 5_000,
  });
  const next = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 800_000,
    prompt_cache_miss_tokens: 15_000,
    completion_tokens: 8_000,
  });
  const delta = usageDelta(prev, next);
  assert.equal(delta.inputTokens, 5_000);
  assert.equal(delta.cachedTokens, 300_000);
  assert.equal(delta.outputTokens, 3_000);
  approx(delta.costUsd, next.costUsd - prev.costUsd, 0.000001);
});

test("mergeUsage accumulates per-turn deltas", () => {
  const a = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 100,
    prompt_cache_miss_tokens: 10,
    completion_tokens: 5,
  });
  const b = costFromUsage("deepseek-v4-flash", {
    prompt_cache_hit_tokens: 200,
    prompt_cache_miss_tokens: 20,
    completion_tokens: 8,
  });
  const m = mergeUsage(a, b);
  assert.equal(m.inputTokens, 30);
  assert.equal(m.cachedTokens, 300);
  assert.equal(m.outputTokens, 13);
  approx(m.costUsd, a.costUsd + b.costUsd, 0.000001);
});
