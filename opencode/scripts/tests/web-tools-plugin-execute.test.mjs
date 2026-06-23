import { test, expect, describe } from "bun:test";

function mockWebSearchRuntime(overrides = {}) {
  return {
    config: {
      webSearch: {
        defaultProvider: "tavily",
        primaryFallbackOrder: ["tavily"],
        reserveFallbackOrder: [],
        count: 3,
        freshness: "pm",
        rawContent: false,
      },
    },
    cache: { getWebSearch: () => undefined, setWebSearch: () => {} },
    db: { recordWebSearch: async () => {} },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchWithFallback: async () => ({
        results: [{ title: "Test", url: "https://test.com", snippet: "snippet" }],
        metadata: { provider: "tavily", latencyMs: 50, unitsUsed: 1, tokensInput: 10, tokensOutput: 20 },
      }),
    },
    recordWithBudget: async () => null,
    ...overrides,
  };
}

function mockFetchContentRuntime(overrides = {}) {
  return {
    config: {
      fetchContent: {
        defaultProvider: "gemini",
        primaryFallbackOrder: ["gemini"],
        reserveFallbackOrder: [],
        format: "markdown",
      },
    },
    cache: { getFetchContent: () => undefined, setFetchContent: () => {} },
    db: { recordFetchContent: async () => {} },
    usage: { recordFromFetch: async () => {} },
    providers: {
      fetchWithFallback: async () => ({
        results: [{ url: "https://example.com", title: "Example", content: "# Hello" }],
        metadata: { provider: "gemini", latencyMs: 100, unitsUsed: 1, tokensInput: 50, tokensOutput: 30 },
      }),
    },
    recordWithBudget: async () => null,
    ...overrides,
  };
}

function mockMapsSearchRuntime(overrides = {}) {
  return {
    config: {
      mapsSearch: { defaultProvider: "gemini", count: 3 },
    },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchMaps: async () => ({
        results: [{ title: "Place", uri: "https://maps.google.com/", placeId: "abc" }],
        metadata: { provider: "gemini", latencyMs: 200, unitsUsed: 1, tokensInput: 30, tokensOutput: 15 },
      }),
    },
    recordWithBudget: async () => null,
    ...overrides,
  };
}

describe("web_search plugin execute stringifies output", () => {
  test("returns a string that parses as JSON with .results array", async () => {
    const { executeWebSearchTool } = await import("../../plugins/web-tools/tools/web-search.ts");
    const result = await executeWebSearchTool({ query: "hello" }, mockWebSearchRuntime());
    const serialized = JSON.stringify(result);
    expect(typeof serialized).toBe("string");
    const parsed = JSON.parse(serialized);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  test("omits provider, latencyMs, tokensInput, tokensOutput from public result", async () => {
    const { executeWebSearchTool } = await import("../../plugins/web-tools/tools/web-search.ts");
    const result = await executeWebSearchTool({ query: "test" }, mockWebSearchRuntime());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("latencyMs");
    expect(serialized).not.toContain("tokensInput");
    expect(serialized).not.toContain("tokensOutput");
  });
});

describe("fetch_content plugin execute stringifies output", () => {
  test("returns a string that parses as JSON with .results array", async () => {
    const { executeFetchContentTool } = await import("../../plugins/web-tools/tools/fetch-content.ts");
    const result = await executeFetchContentTool({ urls: ["https://example.com"] }, mockFetchContentRuntime());
    const serialized = JSON.stringify(result);
    expect(typeof serialized).toBe("string");
    const parsed = JSON.parse(serialized);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  test("omits provider, latencyMs, tokensInput, tokensOutput from public result", async () => {
    const { executeFetchContentTool } = await import("../../plugins/web-tools/tools/fetch-content.ts");
    const result = await executeFetchContentTool({ urls: ["https://example.com"] }, mockFetchContentRuntime());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("latencyMs");
    expect(serialized).not.toContain("tokensInput");
    expect(serialized).not.toContain("tokensOutput");
  });
});

describe("maps_search plugin execute stringifies output", () => {
  test("returns a string that parses as JSON with .results array", async () => {
    const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");
    const result = await executeMapsSearchTool({ query: "cafe" }, mockMapsSearchRuntime());
    const serialized = JSON.stringify(result);
    expect(typeof serialized).toBe("string");
    const parsed = JSON.parse(serialized);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  test("omits provider, latencyMs, tokensInput, tokensOutput from public result", async () => {
    const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");
    const result = await executeMapsSearchTool({ query: "cafe" }, mockMapsSearchRuntime());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("latencyMs");
    expect(serialized).not.toContain("tokensInput");
    expect(serialized).not.toContain("tokensOutput");
  });

  test("lat/lng flow through correctly", async () => {
    const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");
    let receivedLat;
    let receivedLng;
    const result = await executeMapsSearchTool(
      { query: "cafe", lat: 35.6762, lng: 139.6503 },
      mockMapsSearchRuntime({
        providers: {
          searchMaps: async (request) => {
            receivedLat = request.lat;
            receivedLng = request.lng;
            return {
              results: [{ title: "Place", uri: "https://maps.google.com/" }],
              metadata: { provider: "gemini", latencyMs: 100 },
            };
          },
        },
      }),
    );
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized);
    expect(receivedLat).toBe(35.6762);
    expect(receivedLng).toBe(139.6503);
    expect(Array.isArray(parsed.results)).toBe(true);
  });
});
