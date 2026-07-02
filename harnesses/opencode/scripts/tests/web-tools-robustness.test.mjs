import { test, expect, spyOn } from "bun:test";

// ── Strong hash (SHA-256) replaces collision-prone short hash ──────

test("hashString produces consistent output for same input", async () => {
  const { hashString } = await import("../../plugins/tools/web-tools/util/hash.ts");
  const a = hashString("https://example.com/page");
  const b = hashString("https://example.com/page");
  expect(a).toBe(b);
});

test("hashString distinguishes similar URLs", async () => {
  const { hashString } = await import("../../plugins/tools/web-tools/util/hash.ts");
  const urls = [
    "https://example.com/page",
    "https://example.com/page?q=1",
    "https://example.com/page?q=2",
    "https://other.com/page",
    "https://example.com/PAGE",
  ];
  const hashes = urls.map((u) => hashString(u));
  const unique = new Set(hashes);
  expect(unique.size).toBe(urls.length);
});

test("hashString output is hex and reasonable length", async () => {
  const { hashString } = await import("../../plugins/tools/web-tools/util/hash.ts");
  const h = hashString("https://example.com");
  expect(h).toMatch(/^[0-9a-f]{16}$/);
});

test("hashString empty input does not crash", async () => {
  const { hashString } = await import("../../plugins/tools/web-tools/util/hash.ts");
  const h = hashString("");
  expect(h).toMatch(/^[0-9a-f]{16}$/);
});

// ── hashRequest uses the same strong hash ────────────────────────

test("hashRequest produces same hash for same sorted parts", async () => {
  const { hashRequest } = await import("../../plugins/tools/web-tools/util/hash.ts");
  const a = hashRequest({ query: "hello", count: 5 });
  const b = hashRequest({ count: 5, query: "hello" });
  expect(a).toBe(b);
});

test("hashRequest distinguishes different queries", async () => {
  const { hashRequest } = await import("../../plugins/tools/web-tools/util/hash.ts");
  const a = hashRequest({ query: "hello", count: 5 });
  const b = hashRequest({ query: "world", count: 5 });
  expect(a).not.toBe(b);
});

// ── Error sink writes to stderr on rejection ──────────────────────

test("errorSink writes to console.error with context prefix", async () => {
  const { errorSink } = await import("../../plugins/tools/web-tools/util/error-sink.ts");
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    errorSink("test-context")("Something went wrong");
    expect(spy).toHaveBeenCalledWith("[web-tools] test-context: Something went wrong");
  } finally {
    spy.mockRestore();
  }
});

test("errorSink handles Error objects", async () => {
  const { errorSink } = await import("../../plugins/tools/web-tools/util/error-sink.ts");
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    errorSink("test")(new Error("boom"));
    expect(spy).toHaveBeenCalledWith("[web-tools] test: boom");
  } finally {
    spy.mockRestore();
  }
});

// ── Fire-and-forget error propagation via error sink ──────────────

test("web_search .catch is reachable when recordWebSearch rejects", async () => {
  const { executeWebSearchTool } = await import("../../plugins/tools/web-tools/tools/web-search.ts");
  const spy = spyOn(console, "error").mockImplementation(() => {});

  try {
    // recordWebSearch rejects; the tool result should still return normally
    const result = await executeWebSearchTool({ query: "test" }, {
      config: {
        webSearch: { defaultProvider: "brave", primaryFallbackOrder: ["brave"], reserveFallbackOrder: [], count: 3, freshness: "pm", rawContent: false },
      },
      cache: { getWebSearch: () => undefined, setWebSearch: () => {} },
      db: {
        recordWebSearch: async () => { throw new Error("db write failed"); },
      },
      usage: { recordFromSearch: async () => {} },
      providers: {
        searchWithFallback: async () => ({
          results: [{ title: "T", url: "https://t.com", snippet: "s" }],
          metadata: { provider: "brave", latencyMs: 10 },
        }),
      },
      recordWithBudget: async () => null,
    });

    // Tool response is stable despite DB write failure
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("T");

    // Allow microtask to flush the .catch
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledWith("[web-tools] web_search record: db write failed");
  } finally {
    spy.mockRestore();
  }
});

test("fetch_content .catch is reachable when recordFetchContent rejects", async () => {
  const { executeFetchContentTool } = await import("../../plugins/tools/web-tools/tools/fetch-content.ts");
  const spy = spyOn(console, "error").mockImplementation(() => {});

  try {
    const result = await executeFetchContentTool({ urls: ["https://t.com"] }, {
      config: {
        fetchContent: { defaultProvider: "gemini", primaryFallbackOrder: ["gemini"], reserveFallbackOrder: [], format: "markdown" },
      },
      cache: { getFetchContent: () => undefined, setFetchContent: () => {} },
      db: {
        recordFetchContent: async () => { throw new Error("fetch record failed"); },
      },
      usage: { recordFromFetch: async () => {} },
      providers: {
        fetchWithFallback: async () => ({
          results: [{ url: "https://t.com", title: "T", content: "c" }],
          metadata: { provider: "gemini", latencyMs: 10 },
        }),
      },
      recordWithBudget: async () => null,
    });

    expect(result.results).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledWith("[web-tools] fetch_content record: fetch record failed");
  } finally {
    spy.mockRestore();
  }
});

test("maps_search .catch is reachable when recordFromSearch rejects", async () => {
  // The previous implementation called BOTH `usage.recordFromSearch` (with a
  // fire-and-forget .catch) AND `recordWithBudget`, double-counting usage.
  // After the fix, `recordFromSearch` is no longer called, so this scenario
  // is unreachable. This test now pins the new contract: a rejecting
  // `recordFromSearch` is silently ignored because it is never invoked.
  const { executeMapsSearchTool } = await import("../../plugins/tools/web-tools/tools/maps-search.ts");
  const spy = spyOn(console, "error").mockImplementation(() => {});

  try {
    let recordFromSearchCalls = 0;
    const result = await executeMapsSearchTool({ query: "test" }, {
      config: { mapsSearch: { defaultProvider: "gemini", count: 3 } },
      usage: {
        recordFromSearch: async () => {
          recordFromSearchCalls += 1;
          throw new Error("usage record failed");
        },
      },
      providers: {
        searchMaps: async () => ({
          results: [{ title: "Place", uri: "https://maps.google.com/" }],
          metadata: { provider: "gemini", latencyMs: 50 },
        }),
      },
      recordWithBudget: async () => null,
    });

    expect(result.results).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(recordFromSearchCalls).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

// ── DB recording creates distinct rows for similar URLs ──────────

test("recordWebSearch creates distinct rows for similar URLs", async () => {
  const { openTestDb, recordWebSearch } = await import("../../plugins/tools/web-tools/db.ts");
  const db = openTestDb();

  const request = { query: "test", count: 3, freshness: "pm", rawContent: false };

  // Two results with similar URLs should get distinct rows
  await recordWebSearch(db, request, {
    results: [
      { title: "A", url: "https://example.com/page", snippet: "s1" },
      { title: "B", url: "https://example.com/page?q=1", snippet: "s2" },
    ],
    metadata: { provider: "brave" },
  });

  const rows = db.query("select count(*) as cnt from web_search_results").get();
  expect(rows.cnt).toBe(2);
});

test("recordFetchContent creates distinct rows for different URLs", async () => {
  const { openTestDb, recordFetchContent } = await import("../../plugins/tools/web-tools/db.ts");
  const db = openTestDb();

  await recordFetchContent(db, { urls: ["https://a.com", "https://b.com"], mode: "extract", format: "markdown" }, {
    results: [
      { url: "https://a.com", title: "A", content: "aa" },
      { url: "https://b.com", title: "B", content: "bb" },
    ],
    metadata: { provider: "gemini" },
  });

  const rows = db.query("select count(*) as cnt from fetch_content_results").get();
  expect(rows.cnt).toBe(2);
});
