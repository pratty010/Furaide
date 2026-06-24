import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("pricing cache scoping", () => {
  test("reads from configDir, not homedir", async () => {
    const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
    const dir = mkdtempSync(join(tmpdir(), "wt-cache-scope-"));
    try {
      const freshFetchedAt = Date.now() - 1000;
      const cacheContent = {
        fetchedAt: freshFetchedAt,
        prices: { "google/gemini-3.1-flash-lite": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000004 } },
      };
      writeFileSync(join(dir, "web-tools-pricing-cache.json"), JSON.stringify(cacheContent));

      const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
      const cost = pricing.estimateGeminiCall({
        model: "gemini-3.1-flash-lite",
        inputTokens: 1000,
        outputTokens: 500,
        tool: "google_search",
      });
      expect(cost).toBeCloseTo(0.038, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stale cache (>24h) falls back to defaults", async () => {
    const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
    const dir = mkdtempSync(join(tmpdir(), "wt-cache-scope-"));
    try {
      const staleFetchedAt = Date.now() - 2 * 86_400_000;
      const cacheContent = {
        fetchedAt: staleFetchedAt,
        prices: { "google/gemini-3.1-flash-lite": { input_cost_per_token: 0.0001, output_cost_per_token: 0.0001 } },
      };
      writeFileSync(join(dir, "web-tools-pricing-cache.json"), JSON.stringify(cacheContent));

      const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
      const cost = pricing.estimateGeminiCall({
        model: "gemini-3.1-flash-lite",
        inputTokens: 1000,
        outputTokens: 500,
        tool: "google_search",
      });
      expect(cost).toBeCloseTo(0.035225, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("malformed cache falls back to defaults", async () => {
    const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
    const dir = mkdtempSync(join(tmpdir(), "wt-cache-scope-"));
    try {
      writeFileSync(join(dir, "web-tools-pricing-cache.json"), "{ not valid json");
      const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
      const cost = pricing.estimateGeminiCall({
        model: "gemini-3.1-flash-lite",
        inputTokens: 1000,
        outputTokens: 500,
        tool: "google_search",
      });
      expect(cost).toBeCloseTo(0.035225, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing cache falls back to defaults", async () => {
    const { loadPricingHelper } = await import("../../plugins/web-tools/pricing.ts");
    const dir = mkdtempSync(join(tmpdir(), "wt-cache-scope-"));
    try {
      const pricing = loadPricingHelper({ configDir: dir, docsDir: dir });
      const cost = pricing.estimateGeminiCall({
        model: "gemini-3.1-flash-lite",
        inputTokens: 1000,
        outputTokens: 500,
        tool: "google_search",
      });
      expect(cost).toBeCloseTo(0.035225, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
