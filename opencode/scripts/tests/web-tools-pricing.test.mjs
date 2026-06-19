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
