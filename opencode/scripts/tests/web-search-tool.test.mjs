import { test, expect } from "bun:test";

test("web_search returns lean public fields only", async () => {
  const { executeWebSearchTool } = await import("../../plugins/web-tools/tools/web-search.ts");
  const { InMemoryCache } = await import("../../plugins/web-tools/cache.ts");

  const cache = new InMemoryCache({ webSearchTtlMs: 60_000 });

  const testRuntime = {
    config: {
      webSearch: {
        defaultProvider: "brave",
        primaryFallbackOrder: ["brave", "tavily", "gemini"],
        reserveFallbackOrder: [],
        count: 5,
        freshness: "pm",
        rawContent: false,
      },
    },
    cache,
    db: {
      recordWebSearch: async () => {},
    },
    usage: {
      recordFromSearch: async () => {},
    },
    providers: {
      searchWithFallback: async () => ({
        results: [
          { title: "OpenCode Plugins", url: "https://opencode.ai/docs/plugins", snippet: "Documentation for opencode plugins" },
        ],
        metadata: { provider: "brave", latencyMs: 100 },
      }),
    },
  };

  const result = await executeWebSearchTool({ query: "opencode plugins", count: 2 }, testRuntime);

  expect(result).toEqual({
    results: [
      { title: "OpenCode Plugins", url: "https://opencode.ai/docs/plugins", snippet: expect.any(String) },
    ],
  });

  const resultJson = JSON.stringify(result);
  expect(resultJson).not.toContain("provider");
  expect(resultJson).not.toContain("latencyMs");
});

test("web_search applies config defaults when args omitted", async () => {
  const { executeWebSearchTool } = await import("../../plugins/web-tools/tools/web-search.ts");
  const { InMemoryCache } = await import("../../plugins/web-tools/cache.ts");

  const cache = new InMemoryCache({ webSearchTtlMs: 60_000 });

  let capturedRequest = null;

  const testRuntime = {
    config: {
      webSearch: {
        defaultProvider: "brave",
        primaryFallbackOrder: ["brave", "tavily", "gemini"],
        reserveFallbackOrder: [],
        count: 3,
        freshness: "pw",
        rawContent: true,
      },
    },
    cache,
    db: { recordWebSearch: async () => {} },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchWithFallback: async (req) => {
        capturedRequest = req;
        return { results: [], metadata: { provider: "brave", latencyMs: 0 } };
      },
    },
  };

  await executeWebSearchTool({ query: "test" }, testRuntime);
  expect(capturedRequest).toMatchObject({ count: 3, freshness: "pw", rawContent: true });
});
