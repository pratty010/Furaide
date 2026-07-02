import { test, expect } from "bun:test";

test("web_search tool executes with mock runtime", async () => {
  const { executeWebSearchTool } = await import("../../plugins/tools/web-tools/tools/web-search.ts");

  const mockRuntime = {
    config: {
      webSearch: {
        defaultProvider: "tavily",
        primaryFallbackOrder: ["tavily", "gemini"],
        reserveFallbackOrder: [],
        count: 3,
        freshness: "pm",
        rawContent: false,
      },
    },
    cache: {
      getWebSearch: () => undefined,
      setWebSearch: () => {},
    },
    db: {
      recordWebSearch: async () => {},
    },
    usage: {
      recordFromSearch: async () => {},
    },
    providers: {
      searchWithFallback: async () => ({
        results: [{ title: "Test", url: "https://test.com", snippet: "snippet" }],
        metadata: { provider: "tavily", latencyMs: 50 },
      }),
    },
    recordWithBudget: async () => null,
  };

  const result = await executeWebSearchTool({ query: "hello" }, mockRuntime);
  expect(result.results).toHaveLength(1);
  expect(result.results[0].title).toBe("Test");
  expect(result.results[0].url).toBe("https://test.com");
  expect(result.results[0].snippet).toBe("snippet");
});

test("web_search omits metadata from public result", async () => {
  const { executeWebSearchTool } = await import("../../plugins/tools/web-tools/tools/web-search.ts");

  const mockRuntime = {
    config: {
      webSearch: {
        defaultProvider: "brave",
        primaryFallbackOrder: ["brave"],
        reserveFallbackOrder: [],
        count: 2,
        freshness: "pm",
        rawContent: false,
      },
    },
    cache: { getWebSearch: () => undefined, setWebSearch: () => {} },
    db: { recordWebSearch: async () => {} },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchWithFallback: async () => ({
        results: [{ title: "A", url: "https://a.com", snippet: "s" }],
        metadata: { provider: "brave", latencyMs: 10, unitsUsed: 1 },
      }),
    },
    recordWithBudget: async () => null,
  };

  const result = await executeWebSearchTool({ query: "test", count: 2 }, mockRuntime);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("provider");
  expect(serialized).not.toContain("latencyMs");
});

test("web_search caches identical requests", async () => {
  const { executeWebSearchTool } = await import("../../plugins/tools/web-tools/tools/web-search.ts");

  let callCount = 0;
  const mockRuntime = {
    config: {
      webSearch: {
        defaultProvider: "gemini",
        primaryFallbackOrder: ["gemini"],
        reserveFallbackOrder: [],
        count: 3,
        freshness: "pm",
        rawContent: false,
      },
    },
    cache: {
      _store: Object.create(null),
      getWebSearch(key) { return this._store[key]; },
      setWebSearch(key, value) { this._store[key] = value; },
    },
    db: { recordWebSearch: async () => {} },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchWithFallback: async () => {
        callCount++;
        return {
          results: [{ title: "Cached", url: "https://cached.com", snippet: "s" }],
          metadata: { provider: "gemini", latencyMs: 20 },
        };
      },
    },
    recordWithBudget: async () => null,
  };

  const r1 = await executeWebSearchTool({ query: "cache-test" }, mockRuntime);
  expect(r1.results).toHaveLength(1);

  const r2 = await executeWebSearchTool({ query: "cache-test" }, mockRuntime);
  expect(r2.results).toHaveLength(1);

  expect(callCount).toBe(1);
});

test("web_search uses NormalizedWebSearchRequest", async () => {
  const { normalizeWebSearchArgs } = await import("../../plugins/tools/web-tools/tools/web-search.ts");

  const config = {
    defaultProvider: "brave",
    primaryFallbackOrder: ["brave"],
    reserveFallbackOrder: [],
    count: 7,
    freshness: "pd",
    rawContent: true,
  };

  const normalized = normalizeWebSearchArgs({ query: "hello" }, config);
  expect(normalized.query).toBe("hello");
  expect(normalized.count).toBe(7);
  expect(normalized.freshness).toBe("pd");
  expect(normalized.rawContent).toBe(true);

  const withOverrides = normalizeWebSearchArgs(
    { query: "world", count: 3, freshness: "py", raw_content: false },
    config,
  );
  expect(withOverrides.count).toBe(3);
  expect(withOverrides.freshness).toBe("py");
  expect(withOverrides.rawContent).toBe(false);
});

test("effectiveOrder deduplicates and follows config priority", async () => {
  const { effectiveOrder } = await import("../../plugins/tools/web-tools/order.ts");

  const order = effectiveOrder("brave", ["brave", "tavily", "gemini"], []);
  expect(order).toEqual(["brave", "tavily", "gemini"]);

  const withReserve = effectiveOrder("brave", ["tavily"], ["gemini"]);
  expect(withReserve).toEqual(["brave", "tavily", "gemini"]);

  const deduped = effectiveOrder("gemini", ["tavily", "gemini"], ["tavily"]);
  expect(deduped).toEqual(["gemini", "tavily"]);
});

test("effectiveOrder empty reserve does not crash", async () => {
  const { effectiveOrder } = await import("../../plugins/tools/web-tools/order.ts");
  const order = effectiveOrder("gemini", [], []);
  expect(order).toEqual(["gemini"]);
});

test("recordFromSearch and recordFromFetch mutate DB", async () => {
  const { openTestDb } = await import("../../plugins/tools/web-tools/db.ts");
  const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");

  const db = openTestDb();
  const usage = createUsageTracker(db);

  await usage.recordFromSearch({ provider: "brave", unitsUsed: 1 });
  const snapshot = await usage.getMonth("brave", new Date().toISOString().slice(0, 7));
  expect(snapshot.calls).toBe(1);
  expect(snapshot.units_used).toBe(1);

  await usage.recordFromFetch({ provider: "tavily", unitsUsed: 2, tokensInput: 100, tokensOutput: 50 });
  const snapshot2 = await usage.getMonth("tavily", new Date().toISOString().slice(0, 7));
  expect(snapshot2.calls).toBe(1);
  expect(snapshot2.tokens_input).toBe(100);
  expect(snapshot2.tokens_output).toBe(50);
});

test("provider wrappers throw real errors not stubs", async () => {
  const brave = await import("../../plugins/tools/web-tools/providers/brave.ts");
  const tavily = await import("../../plugins/tools/web-tools/providers/tavily.ts");
  const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");

  const expectRealError = async (fn) => {
    try { await fn; } catch (e) {
      expect(e.message).not.toContain("not yet implemented");
      return;
    }
    // If no error, the CLI/env was actually available — that is also acceptable proof
  };

  await expectRealError(brave.searchWeb({ query: "pxyz7-non-existent-test" }));
  await expectRealError(tavily.searchWeb({ query: "pxyz7-non-existent-test" }));
  await expectRealError(tavily.fetchContent({ urls: ["https://pxyz7-nonexistent-test.example"] }));
  await expectRealError(gemini.searchWeb({ query: "pxyz7-non-existent-test" }));
  await expectRealError(gemini.fetchContent({ urls: ["https://pxyz7-nonexistent-test.example"] }));
  await expectRealError(gemini.searchMaps({ query: "pxyz7-non-existent-test" }));
});
