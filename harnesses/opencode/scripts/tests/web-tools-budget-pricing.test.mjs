import { test, expect, describe, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";

const currentMonth = `${new Date().toISOString().slice(0, 7)}`;

// ── Gemini pricing overlay ──────────────────────────────────────────

describe("Gemini pricing overlay", () => {
  test("createPricingHelper computes token cost + tool fee", async () => {
    const { createPricingHelper } = await import("../../plugins/tools/web-tools/pricing.ts");

    const pricing = createPricingHelper({
      litellm: { "gemini-3.1-flash-lite": { input_cost_per_token: 0.000000075, output_cost_per_token: 0.0000003 } },
      fees: { "gemini-3.1-flash-lite": { google_search: 0.035, googleMaps: 0.035, url_context: 0 } },
    });

    const cost = pricing.estimateGeminiCall({
      model: "gemini-3.1-flash-lite",
      inputTokens: 1000,
      outputTokens: 500,
      tool: "google_search",
    });
    // token cost: 1000*7.5e-8 + 500*3e-7 = 0.000075 + 0.00015 = 0.000225
    // tool fee: 0.035
    // total: 0.035225
    expect(cost).toBeCloseTo(0.035225, 6);
  });

  test("pricing helper fallback model prefix lookups work", async () => {
    const { createPricingHelper } = await import("../../plugins/tools/web-tools/pricing.ts");

    const pricing = createPricingHelper({
      litellm: { "google/gemini-3.1-flash-lite": { input_cost_per_token: 1e-7, output_cost_per_token: 4e-7 } },
      fees: { "gemini-3.1-flash-lite": { google_search: 0.035 } },
    });

    const cost = pricing.estimateGeminiCall({
      model: "gemini-3.1-flash-lite",
      inputTokens: 0,
      outputTokens: 0,
      tool: "google_search",
    });
    expect(cost).toBeCloseTo(0.035, 6);
  });

  test("pricing helper throws for unknown model", async () => {
    const { createPricingHelper } = await import("../../plugins/tools/web-tools/pricing.ts");

    const pricing = createPricingHelper({
      litellm: {},
      fees: {},
    });

    expect(() =>
      pricing.estimateGeminiCall({
        model: "nonexistent-model",
        inputTokens: 0,
        outputTokens: 0,
        tool: "google_search",
      }),
    ).toThrow("Unknown model");
  });

  test("estimateGeminiCost is applied to metadata when pricing is available", async () => {
    const { createPricingHelper } = await import("../../plugins/tools/web-tools/pricing.ts");

    const pricing = createPricingHelper({
      litellm: { "gemini-3.1-flash-lite": { input_cost_per_token: 1e-7, output_cost_per_token: 4e-7 } },
      fees: { "gemini-3.1-flash-lite": { google_search: 0.035, googleMaps: 0.035, url_context: 0 } },
    });

    // Verify the pricing helper correctly computes cost
    const costSearch = pricing.estimateGeminiCall({
      model: "gemini-3.1-flash-lite",
      inputTokens: 1000,
      outputTokens: 500,
      tool: "google_search",
    });
    expect(costSearch).toBeGreaterThan(0.035);
    expect(costSearch).toBeCloseTo(0.0353, 4);

    const costMaps = pricing.estimateGeminiCall({
      model: "gemini-3.1-flash-lite",
      inputTokens: 1000,
      outputTokens: 500,
      tool: "googleMaps",
    });
    expect(costMaps).toBeCloseTo(0.0353, 4);

    const costUrlContext = pricing.estimateGeminiCall({
      model: "gemini-3.1-flash-lite",
      inputTokens: 1000,
      outputTokens: 500,
      tool: "url_context",
    });
    // token-only cost: 1000*1e-7 + 500*4e-7 = 0.0001 + 0.0002 = 0.0003, no tool fee
    expect(costUrlContext).toBeCloseTo(0.0003, 6);
  });

  test("Vertex-path fee lookup for google_search returns the real non-zero fee (regression for I1)", async () => {
    // Regression for the silent-undercounting bug: gemini-vertex.ts used to pass
    // the camelCase Vertex *request body* field name ("googleSearch") as the
    // *pricing lookup key* too, but docs/models/gemini-tool-fees.yml and
    // pricing.ts's EstimateGeminiCallInput are keyed in snake_case
    // ("google_search"), so the lookup silently fell back to 0. This loads the
    // real production pricing config (same loader gemini-vertex.ts's runtime
    // uses) and asserts the fee is non-zero and matches the documented value.
    const { loadPricingHelper } = await import("../../plugins/tools/web-tools/pricing.ts");
    const { join } = await import("node:path");

    const docsDir = join(import.meta.dir, "..", "..", "docs");
    const configDir = join(import.meta.dir, "..", "..", "config");
    const pricing = loadPricingHelper({ configDir, docsDir });

    const withCorrectKey = pricing.estimateGeminiCall({
      model: "gemini-3.1-flash-lite",
      inputTokens: 0,
      outputTokens: 0,
      tool: "google_search",
    });
    expect(withCorrectKey).toBeGreaterThan(0);
    expect(withCorrectKey).toBeCloseTo(0.035, 6);

    // Guard against the pricing-lookup argument regressing back to the
    // camelCase Vertex request-body field name.
    const { readFileSync } = await import("node:fs");
    const vertexSource = readFileSync(
      join(import.meta.dir, "..", "..", "plugins", "tools", "web-tools", "providers", "gemini-vertex.ts"),
      "utf8",
    );
    expect(vertexSource).toContain('estimateGeminiCost(args.pricing, DEFAULT_MODEL, "google_search"');
    expect(vertexSource).not.toContain('estimateGeminiCost(args.pricing, DEFAULT_MODEL, "googleSearch"');
  });
});

// ── Budget threshold crossing ───────────────────────────────────────

describe("Budget enforcement", () => {
  function makeSnapshot(overrides = {}) {
    return {
      provider: "gemini",
      month: currentMonth,
      calls: 10,
      units_used: 10,
      estimated_cost_usd: 0,
      tokens_input: 1000,
      tokens_output: 500,
      warning_80_shown: 0,
      warning_90_shown: 0,
      budget_exceeded_shown: 0,
      suppressed: 0,
      last_call_at: null,
      ...overrides,
    };
  }

  const budgets = { geminiUsd: 5.0, braveRequests: 2000, tavilyCredits: 1000 };

  test("no warning when usage is below 80%", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 3.0 }), "gemini");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("none");
    expect(result.preamble).toBeNull();
  });

  test("warn80 at 80% gemini budget", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.0 }), "gemini");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("warn80");
    expect(result.preamble).toContain("80%");
    expect(result.preamble).toContain("gemini");
  });

  test("warn90 at 90% gemini budget", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.5 }), "gemini");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("warn90");
    expect(result.preamble).toContain("90%");
  });

  test("gemini blocked at 100% budget", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 5.0 }), "gemini");
    expect(result.blocked).toBe(true);
    expect(result.warningLevel).toBe("exceeded");
    expect(result.preamble).toContain("Budget exceeded");
  });

  test("brave warn80 at 80% requests", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ units_used: 1600 }), "brave");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("warn80");
  });

  test("brave blocks at 90% requests", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ units_used: 1800 }), "brave");
    expect(result.blocked).toBe(true);
    expect(result.warningLevel).toBe("exceeded");
  });

  test("tavily warn80 at 80% credits", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ units_used: 800 }), "tavily");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("warn80");
  });

  test("suppressed flag suppresses all warnings", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 5.0, suppressed: 1 }), "gemini");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("none");
    expect(result.preamble).toBeNull();
  });

  test("null budgets never block", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const result = checkBudget(null, makeSnapshot({ estimated_cost_usd: 100 }), "gemini");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("none");
    expect(result.preamble).toBeNull();
  });
});

// ── Warning state updates ───────────────────────────────────────────

describe("Warning state updates in DB", () => {
  function setupDb() {
    const db = new Database(":memory:");
    db.exec(`
      create table provider_usage (
        provider text not null,
        month text not null,
        calls integer not null default 0,
        units_used real not null default 0,
        estimated_cost_usd real not null default 0,
        tokens_input integer not null default 0,
        tokens_output integer not null default 0,
        warning_80_shown integer not null default 0,
        warning_90_shown integer not null default 0,
        budget_exceeded_shown integer not null default 0,
        suppressed integer not null default 0,
        last_call_at text,
        primary key (provider, month)
      )
    `);
    // seed some usage
    db.prepare(`
      insert into provider_usage (provider, month, calls, units_used, estimated_cost_usd, tokens_input, tokens_output, suppressed, last_call_at)
      values ('gemini', '${currentMonth}', 10, 10, 4.5, 1000, 500, 0, datetime('now'))
    `).run();
    return db;
  }

  test("checkAndRecord updates warning flags on threshold crossing", async () => {
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const budgets = { geminiUsd: 5.0, braveRequests: 2000, tavilyCredits: 1000 };

    const db = setupDb();
    const usage = createUsageTracker(db, budgets);

    const { snapshot, budget } = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 1.0,
      tokensInput: 100,
      tokensOutput: 50,
    });

    expect(budget.warningLevel).toBe("exceeded");
    expect(snapshot.warning_80_shown).toBe(1);
    expect(snapshot.warning_90_shown).toBe(1);
    expect(snapshot.budget_exceeded_shown).toBe(1);
  });

  test("checkAndRecord does not block when budget not exceeded", async () => {
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const budgets = { geminiUsd: 5.0, braveRequests: 2000, tavilyCredits: 1000 };

    const db = setupDb();
    const usage = createUsageTracker(db, budgets);

    const { snapshot, budget } = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.1,
      tokensInput: 100,
      tokensOutput: 50,
    });

    expect(budget.blocked).toBe(false);
    expect(snapshot.calls).toBe(11);
  });
});

// ── Maps usage tracking ─────────────────────────────────────────────

describe("Maps usage tracking", () => {
  test("executeMapsSearchTool records usage exactly once via recordWithBudget", async () => {
    // Single-source-of-truth contract: recordWithBudget is the only path that
    // records usage for maps_search. recordFromSearch must not be called
    // (calling both would double-count units/cost).
    const { executeMapsSearchTool } = await import("../../plugins/tools/web-tools/tools/maps-search.ts");

    let recordFromSearchCalls = 0;
    let recordedMetadata = null;
    const mockRuntime = {
      config: { mapsSearch: { defaultProvider: "gemini", count: 3 } },
      usage: {
        recordFromSearch: async () => {
          recordFromSearchCalls += 1;
        },
      },
      providers: {
        searchMaps: async () => ({
          results: [{ title: "Place", uri: "https://maps.google.com/" }],
          metadata: { provider: "gemini", latencyMs: 50, unitsUsed: 1, tokensInput: 100, tokensOutput: 50 },
        }),
      },
      recordWithBudget: async (provider, metadata) => {
        recordedMetadata = { provider, ...metadata };
        return null;
      },
    };

    await executeMapsSearchTool({ query: "test" }, mockRuntime);
    expect(recordedMetadata).not.toBeNull();
    expect(recordedMetadata.provider).toBe("gemini");
    expect(recordedMetadata.unitsUsed).toBe(1);
    expect(recordedMetadata.tokensInput).toBe(100);
    expect(recordedMetadata.tokensOutput).toBe(50);
    expect(recordFromSearchCalls).toBe(0);
  });

  test("executeMapsSearchTool includes _warning when recordWithBudget returns preamble", async () => {
    const { executeMapsSearchTool } = await import("../../plugins/tools/web-tools/tools/maps-search.ts");

    const mockRuntime = {
      config: { mapsSearch: { defaultProvider: "gemini", count: 3 } },
      usage: { recordFromSearch: async () => {} },
      providers: {
        searchMaps: async () => ({
          results: [{ title: "Place", uri: "https://maps.google.com/" }],
          metadata: { provider: "gemini", latencyMs: 50, unitsUsed: 1 },
        }),
      },
      recordWithBudget: async () => "[Budget warning] gemini: 80%+ threshold crossed.",
    };

    const result = await executeMapsSearchTool({ query: "test" }, mockRuntime);
    expect(result._warning).toBe("[Budget warning] gemini: 80%+ threshold crossed.");
  });
});

// ── Warning preamble in tool responses ──────────────────────────────

describe("Warning preamble behavior", () => {
  test("web_search adds _warning when recordWithBudget returns preamble", async () => {
    const { executeWebSearchTool } = await import("../../plugins/tools/web-tools/tools/web-search.ts");

    const mockRuntime = {
      config: {
        webSearch: {
          defaultProvider: "gemini",
          primaryFallbackOrder: ["gemini"],
          reserveFallbackOrder: [],
          count: 3, freshness: "pm", rawContent: false,
        },
      },
      cache: { getWebSearch: () => undefined, setWebSearch: () => {} },
      db: { recordWebSearch: async () => {} },
      usage: { recordFromSearch: async () => {} },
      providers: {
        searchWithFallback: async () => ({
          results: [{ title: "T", url: "https://t.com", snippet: "s" }],
          metadata: { provider: "gemini", latencyMs: 10 },
        }),
      },
      recordWithBudget: async () => "[Budget warning] gemini: 90%+ threshold crossed.",
    };

    const result = await executeWebSearchTool({ query: "test" }, mockRuntime);
    expect(result._warning).toBe("[Budget warning] gemini: 90%+ threshold crossed.");
  });

  test("fetch_content adds _warning when recordWithBudget returns preamble", async () => {
    const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

    const mockRuntime = {
      config: { fetchContent: { defaultProvider: "gemini", primaryFallbackOrder: ["gemini"], reserveFallbackOrder: [], format: "markdown" } },
      cache: { getFetchContent: () => undefined, setFetchContent: () => {} },
      db: { recordFetchContent: async () => {} },
      usage: { recordFromFetch: async () => {} },
      providers: {
        fetchWithFallback: async () => ({
          results: [{ url: "https://t.com", title: "T", content: "c" }],
          metadata: { provider: "gemini", latencyMs: 10 },
        }),
      },
      recordWithBudget: async () => "test preamble",
    };

    const result = await executeFetchContentTool({ urls: ["https://t.com"] }, mockRuntime);
    expect(result._warning).toBe("test preamble");
  });

  test("no preamble when recordWithBudget returns null", async () => {
    const { executeWebSearchTool } = await import("../../plugins/tools/web-tools/tools/web-search.ts");

    const mockRuntime = {
      config: { webSearch: { defaultProvider: "brave", primaryFallbackOrder: ["brave"], reserveFallbackOrder: [], count: 3, freshness: "pm", rawContent: false } },
      cache: { getWebSearch: () => undefined, setWebSearch: () => {} },
      db: { recordWebSearch: async () => {} },
      usage: { recordFromSearch: async () => {} },
      providers: {
        searchWithFallback: async () => ({
          results: [{ title: "T", url: "https://t.com", snippet: "s" }],
          metadata: { provider: "brave", latencyMs: 10 },
        }),
      },
      recordWithBudget: async () => null,
    };

    const result = await executeWebSearchTool({ query: "test" }, mockRuntime);
    expect(result._warning).toBeUndefined();
  });
});

// ── InMemoryCache basic operations ──────────────────────────────────

describe("InMemoryCache basic operations", () => {
  test("get/set and TTL expiration", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");

    const cache = new InMemoryCache();
    cache.set("key1", "value1", 5000);
    expect(cache.get("key1")).toBe("value1");

    cache.set("expired", "gone", -1);
    expect(cache.get("expired")).toBeUndefined();
  });

  test("size and clear", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");

    const cache = new InMemoryCache();
    expect(cache.size).toBe(0);
    cache.set("a", 1, 5000);
    cache.set("b", 2, 5000);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  test("get/set typed wrappers (webSearch/fetchContent)", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");

    const cache = new InMemoryCache();
    const searchData = { results: [{ title: "Test", url: "https://example.com", snippet: "desc" }] };
    const fetchData = { results: [{ url: "https://example.com", title: "Page", content: "content" }] };

    cache.setWebSearch("q1", searchData);
    expect(cache.getWebSearch("q1")).toEqual(searchData);

    cache.setFetchContent("f1", fetchData);
    expect(cache.getFetchContent("f1")).toEqual(fetchData);
  });
});
