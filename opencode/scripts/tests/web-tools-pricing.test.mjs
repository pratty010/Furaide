import { test, expect } from "bun:test";

test("gemini tool fee supplement is applied on top of token pricing", async () => {
  const { createPricingHelper } = await import("../../plugins/web-tools/pricing.ts");

  const pricing = createPricingHelper({
    litellm: { "google/gemini-3.1-flash-lite": { input_cost_per_token: 0.0000001, output_cost_per_token: 0.0000004 } },
    fees: { "gemini-3.1-flash-lite": { google_search: 0.035 } },
  });

  const cost = pricing.estimateGeminiCall({ model: "gemini-3.1-flash-lite", inputTokens: 1000, outputTokens: 500, tool: "google_search" });
  expect(cost).toBeCloseTo(0.0353, 4);
});
