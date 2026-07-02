import { test, expect, describe, beforeAll, afterAll } from "bun:test";

test("fetch_content tool executes with mock runtime", async () => {
  const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

  const mockRuntime = {
    config: {
      fetchContent: {
        defaultProvider: "gemini",
        primaryFallbackOrder: ["gemini", "tavily"],
        reserveFallbackOrder: [],
        format: "markdown",
      },
    },
    cache: {
      getFetchContent: () => undefined,
      setFetchContent: () => {},
    },
    db: {
      recordFetchContent: async () => {},
    },
    usage: {
      recordFromFetch: async () => {},
    },
    providers: {
      fetchWithFallback: async () => ({
        results: [{ url: "https://example.com", title: "Example", content: "# Hello" }],
        metadata: { provider: "gemini", latencyMs: 100 },
      }),
    },
    recordWithBudget: async () => null,
  };

  const result = await executeFetchContentTool(
    { urls: ["https://example.com"] },
    mockRuntime,
  );
  expect(result.results).toHaveLength(1);
  expect(result.results[0].url).toBe("https://example.com");
  expect(result.results[0].title).toBe("Example");
  expect(result.results[0].content).toBe("# Hello");
});

test("fetch_content omits content in map mode", async () => {
  const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

  const mockRuntime = {
    config: {
      fetchContent: {
        defaultProvider: "tavily",
        primaryFallbackOrder: ["tavily"],
        reserveFallbackOrder: [],
        format: "markdown",
      },
    },
    cache: { getFetchContent: () => undefined, setFetchContent: () => {} },
    db: { recordFetchContent: async () => {} },
    usage: { recordFromFetch: async () => {} },
    providers: {
      fetchWithFallback: async () => ({
        results: [
          { url: "https://example.com", title: "Example", content: "hidden" },
          { url: "https://other.com", title: "Other", content: "hidden" },
        ],
        metadata: { provider: "tavily", latencyMs: 50 },
      }),
    },
    recordWithBudget: async () => null,
  };

  const result = await executeFetchContentTool(
    { urls: ["https://example.com"], mode: "map" },
    mockRuntime,
  );
  expect(result.results).toHaveLength(2);
  expect(result.results[0].url).toBe("https://example.com");
  expect(result.results[0].title).toBe("Example");
  expect(result.results[0].content).toBeUndefined();
  expect(result.results[1].content).toBeUndefined();
});

test("fetch_content caches identical requests", async () => {
  const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

  let callCount = 0;
  const mockRuntime = {
    config: {
      fetchContent: {
        defaultProvider: "gemini",
        primaryFallbackOrder: ["gemini"],
        reserveFallbackOrder: [],
        format: "text",
      },
    },
    cache: {
      _store: {},
      getFetchContent(key) { return this._store[key]; },
      setFetchContent(key, value) { this._store[key] = value; },
    },
    db: { recordFetchContent: async () => {} },
    usage: { recordFromFetch: async () => {} },
    providers: {
      fetchWithFallback: async () => {
        callCount++;
        return {
          results: [{ url: "https://cached.com", title: "Cached", content: "data" }],
          metadata: { provider: "gemini", latencyMs: 30 },
        };
      },
    },
    recordWithBudget: async () => null,
  };

  const r1 = await executeFetchContentTool({ urls: ["https://cached.com"] }, mockRuntime);
  expect(r1.results).toHaveLength(1);
  const r2 = await executeFetchContentTool({ urls: ["https://cached.com"] }, mockRuntime);
  expect(r2.results).toHaveLength(1);
  expect(callCount).toBe(1);
});

test("fetch_content NormalizedFetchContentRequest defaults", async () => {
  const { normalizeFetchContentArgs } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

  const config = {
    defaultProvider: "gemini",
    primaryFallbackOrder: ["gemini"],
    reserveFallbackOrder: [],
    format: "markdown",
  };

  const normalized = normalizeFetchContentArgs({ urls: ["https://a.com"] }, config);
  expect(normalized.mode).toBe("extract");
  expect(normalized.format).toBe("markdown");
});

describe("fetch_content DNS rebinding integration", () => {
  test("rejects URL when runtime.resolveHost maps to private IP", async () => {
    const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

    const mockRuntime = {
      config: {
        fetchContent: { defaultProvider: "gemini", primaryFallbackOrder: ["gemini"], reserveFallbackOrder: [], format: "markdown" },
      },
      cache: { getFetchContent: () => undefined, setFetchContent: () => {} },
      db: { recordFetchContent: async () => {} },
      usage: { recordFromFetch: async () => {} },
      providers: { fetchWithFallback: async () => { throw new Error("should not be called"); } },
      recordWithBudget: async () => null,
      resolveHost: async (h) => (h === "evil.example" ? ["10.0.0.1"] : ["93.184.216.34"]),
    };

    await expect(
      executeFetchContentTool({ urls: ["https://evil.example/"] }, mockRuntime),
    ).rejects.toThrow(/resolves to private\/unsafe/);
  });

  test("accepts URL when runtime.resolveHost maps to public IP", async () => {
    const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");

    const mockRuntime = {
      config: {
        fetchContent: { defaultProvider: "gemini", primaryFallbackOrder: ["gemini"], reserveFallbackOrder: [], format: "markdown" },
      },
      cache: { getFetchContent: () => undefined, setFetchContent: () => {} },
      db: { recordFetchContent: async () => {} },
      usage: { recordFromFetch: async () => {} },
      providers: {
        fetchWithFallback: async () => ({
          results: [{ url: "https://example.com/", title: "Example", content: "x" }],
          metadata: { provider: "gemini", latencyMs: 10 },
        }),
      },
      recordWithBudget: async () => null,
      resolveHost: async () => ["93.184.216.34"],
    };

    const result = await executeFetchContentTool({ urls: ["https://example.com/"] }, mockRuntime);
    expect(result.results[0].url).toBe("https://example.com/");
  });
});

describe("Gemini fetchContent mode validation", () => {
  const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_LOCATION", "VERTEX_LOCATION"];
  const ORIG = {};

  beforeAll(() => {
    for (const k of KEYS) { ORIG[k] = process.env[k]; delete process.env[k]; }
  });

  afterAll(() => {
    for (const k of KEYS) {
      if (ORIG[k] === undefined) delete process.env[k];
      else process.env[k] = ORIG[k];
    }
  });

  test("rejects crawl mode before API key check", async () => {
    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");

    await expect(gemini.fetchContent({
      urls: ["https://example.com"],
      mode: "crawl",
    })).rejects.toThrow("does not support mode 'crawl'");
  });

  test("rejects map mode before API key check", async () => {
    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");

    await expect(gemini.fetchContent({
      urls: ["https://example.com"],
      mode: "map",
    })).rejects.toThrow("does not support mode 'map'");
  });

  test("accepts extract mode (fails on API key, not mode)", async () => {
    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");

    await expect(gemini.fetchContent({
      urls: ["https://example.com"],
      mode: "extract",
    })).rejects.toThrow(/No Google credentials/);
  });

  test("defaults to extract mode when no mode given", async () => {
    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");

    await expect(gemini.fetchContent({
      urls: ["https://example.com"],
    })).rejects.toThrow(/No Google credentials/);
  });
});
