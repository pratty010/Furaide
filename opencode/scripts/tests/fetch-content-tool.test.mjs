import { test, expect } from "bun:test";

test("fetch_content returns content in extract mode by default", async () => {
  const { executeFetchContentTool } = await import("../../plugins/web-tools/tools/fetch-content.ts");
  const { InMemoryCache } = await import("../../plugins/web-tools/cache.ts");

  const cache = new InMemoryCache({ fetchContentTtlMs: 60_000 });

  const testRuntime = {
    config: {
      fetchContent: {
        defaultProvider: "gemini",
        primaryFallbackOrder: ["gemini", "tavily"],
        reserveFallbackOrder: [],
        format: "markdown",
      },
    },
    cache,
    db: { recordFetchContent: async () => {} },
    usage: { recordFromFetch: async () => {} },
    providers: {
      fetchWithFallback: async () => ({
        results: [
          { url: "https://opencode.ai/docs/plugins", title: "OpenCode Plugins", content: "# OpenCode Plugins\n\nDocumentation..." },
        ],
        metadata: { provider: "gemini", latencyMs: 200 },
      }),
    },
  };

  const result = await executeFetchContentTool({ urls: ["https://opencode.ai/docs/plugins"] }, testRuntime);

  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toEqual({
    url: "https://opencode.ai/docs/plugins",
    title: "OpenCode Plugins",
    content: expect.any(String),
  });
});

test("fetch_content omits content in map mode", async () => {
  const { executeFetchContentTool } = await import("../../plugins/web-tools/tools/fetch-content.ts");
  const { InMemoryCache } = await import("../../plugins/web-tools/cache.ts");

  const cache = new InMemoryCache({ fetchContentTtlMs: 60_000 });

  const testRuntime = {
    config: {
      fetchContent: {
        defaultProvider: "gemini",
        primaryFallbackOrder: ["gemini", "tavily"],
        reserveFallbackOrder: [],
        format: "markdown",
      },
    },
    cache,
    db: { recordFetchContent: async () => {} },
    usage: { recordFromFetch: async () => {} },
    providers: {
      fetchWithFallback: async () => ({
        results: [
          { url: "https://opencode.ai/docs/plugins", title: "OpenCode Plugins", content: "# OpenCode Plugins\n\nDocumentation..." },
        ],
        metadata: { provider: "gemini", latencyMs: 200 },
      }),
    },
  };

  const result = await executeFetchContentTool({ urls: ["https://opencode.ai/docs/plugins"], mode: "map" }, testRuntime);

  expect(result.results[0]).toEqual({
    url: "https://opencode.ai/docs/plugins",
    title: expect.any(String),
  });
  expect(result.results[0].content).toBeUndefined();
});

test("fetch_content applies config defaults when args omitted", async () => {
  const { normalizeFetchContentArgs } = await import("../../plugins/web-tools/tools/fetch-content.ts");

  const config = {
    defaultProvider: "gemini",
    primaryFallbackOrder: ["gemini", "tavily"],
    reserveFallbackOrder: [],
    format: "text",
  };

  const normalized = normalizeFetchContentArgs({ urls: ["https://example.com"] }, config);
  expect(normalized.format).toBe("text");
  expect(normalized.mode).toBe("extract");
});
