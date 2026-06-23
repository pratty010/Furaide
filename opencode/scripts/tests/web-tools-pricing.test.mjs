import { test, expect } from "bun:test";

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("gemini tool fee supplement is applied on top of token pricing", async () => {
  const { createPricingHelper } = await import("../../plugins/web-tools/pricing.ts");

  const pricing = createPricingHelper({
    litellm: { "google/gemini-3.1-flash-lite": { input_cost_per_token: 0.0000001, output_cost_per_token: 0.0000004 } },
    fees: { "gemini-3.1-flash-lite": { google_search: 0.035 } },
  });

  const cost = pricing.estimateGeminiCall({ model: "gemini-3.1-flash-lite", inputTokens: 1000, outputTokens: 500, tool: "google_search" });
  expect(cost).toBeCloseTo(0.0353, 4);
});

test("loadPricingHelper loads fee file synchronously", async () => {
  const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-pricing-"));
  try {
    mkdirSync(join(dir, "docs", "models"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "models", "gemini-tool-fees.yml"),
      "gemini-3.1-flash-lite:\n  google_search: 0.035\n  googleMaps: 0.035\n  url_context: 0\n",
    );
    const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
    const cost = pricing.estimateGeminiCall({ model: "gemini-3.1-flash-lite", inputTokens: 1000, outputTokens: 500, tool: "google_search" });
    expect(cost).toBeCloseTo(0.035225, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPricingHelper falls back to defaults when fee file missing", async () => {
  const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-pricing-"));
  try {
    const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
    const cost = pricing.estimateGeminiCall({ model: "gemini-3.1-flash-lite", inputTokens: 1000, outputTokens: 500, tool: "google_search" });
    expect(cost).toBeCloseTo(0.035225, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPricingHelper rejects cache with future fetchedAt (poisoned cache pinned forever)", async () => {
  // Adversarial: a poisoned cache file with fetchedAt in the future would
  // otherwise pass the freshness check forever (now - futureDate < 86_400_000
  // is always true for negative deltas). The fix adds a fetchedAt <= now guard.
  const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-pricing-"));
  try {
    const futureCache = {
      fetchedAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      prices: { "google/attacker-model": { input_cost_per_token: 0, output_cost_per_token: 0 } },
    };
    writeFileSync(join(dir, "web-tools-pricing-cache.json"), JSON.stringify(futureCache));

    const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
    // Should fall back to the built-in defaults, not the poisoned entry
    const cost = pricing.estimateGeminiCall({ model: "gemini-3.1-flash-lite", inputTokens: 1000, outputTokens: 500, tool: "google_search" });
    expect(cost).toBeCloseTo(0.035225, 5);
    expect(() => pricing.estimateGeminiCall({ model: "attacker-model", inputTokens: 1, outputTokens: 0, tool: "google_search" })).toThrow(/Unknown model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPricingHelper rejects cache with non-finite fetchedAt", async () => {
  const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-pricing-"));
  try {
    const poisoned = {
      fetchedAt: Number.POSITIVE_INFINITY,
      prices: { "google/attacker-model": { input_cost_per_token: 0, output_cost_per_token: 0 } },
    };
    writeFileSync(join(dir, "web-tools-pricing-cache.json"), JSON.stringify(poisoned));
    const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
    expect(() => pricing.estimateGeminiCall({ model: "attacker-model", inputTokens: 1, outputTokens: 0, tool: "google_search" })).toThrow(/Unknown model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPricingHelper accepts cache with recent fetchedAt", async () => {
  const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-pricing-"));
  try {
    const recent = {
      fetchedAt: Date.now() - 60_000,
      prices: { "google/gemini-3.1-flash-lite": { input_cost_per_token: 0.0000001, output_cost_per_token: 0.0000004 } },
    };
    writeFileSync(join(dir, "web-tools-pricing-cache.json"), JSON.stringify(recent));
    const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
    // Default google_search fee is 0.035 (no fee file in this temp dir), so:
    // 0.0001 * 1000 + 0.0004 * 500 + 0.035 = 0.0353
    const cost = pricing.estimateGeminiCall({ model: "gemini-3.1-flash-lite", inputTokens: 1000, outputTokens: 500, tool: "google_search" });
    expect(cost).toBeCloseTo(0.0353, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
