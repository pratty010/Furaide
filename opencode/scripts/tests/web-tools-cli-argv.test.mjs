import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const BRAVE_KEY = "test-brave-key";
const TAVILY_KEY = "test-tavily-key";

let originalFetch;
let originalBraveKey;
let originalTavilyKey;

beforeAll(() => {
  originalFetch = globalThis.fetch;
  originalBraveKey = process.env.BRAVE_API_KEY;
  originalTavilyKey = process.env.TAVILY_API_KEY;
  process.env.BRAVE_API_KEY = BRAVE_KEY;
  process.env.TAVILY_API_KEY = TAVILY_KEY;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBraveKey === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = originalBraveKey;
  if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalTavilyKey;
});

function setKey(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function captureFetch(response, capture) {
  return async (url, init) => {
    capture.url = String(url);
    capture.headers = init && init.headers;
    capture.body = init && init.body;
    return typeof response === "function" ? response() : response;
  };
}

function okJson(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("brave direct HTTPS contract", () => {
  test("rejects null/non-string query", async () => {
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: null })).rejects.toThrow();
  });

  test("rejects empty query", async () => {
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: "" })).rejects.toThrow();
  });

  test("rejects oversized query (>2000 chars)", async () => {
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: "a".repeat(2001) })).rejects.toThrow();
  });

  test("fails cleanly when BRAVE_API_KEY is missing", async () => {
    const saved = process.env.BRAVE_API_KEY;
    setKey("BRAVE_API_KEY", undefined);
    try {
      const brave = await import("../../plugins/web-tools/providers/brave.ts");
      await expect(brave.searchWeb({ query: "x" })).rejects.toThrow(/BRAVE_API_KEY/);
    } finally {
      setKey("BRAVE_API_KEY", saved);
    }
  });

  test("sends API key via X-Subscription-Token header, never URL", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({ web: { results: [] } }), cap);
    try {
      const brave = await import("../../plugins/web-tools/providers/brave.ts");
      await brave.searchWeb({ query: "test" });
      expect(cap.url).not.toContain("BRAVE_API_KEY=");
      expect(cap.url).not.toContain(BRAVE_KEY);
      const h = new Headers(cap.headers);
      expect(h.get("X-Subscription-Token")).toBe(BRAVE_KEY);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws sanitized error on non-200 response", async () => {
    globalThis.fetch = captureFetch(
      new Response("upstream error body", { status: 502, statusText: "Bad Gateway" }),
      {},
    );
    try {
      const brave = await import("../../plugins/web-tools/providers/brave.ts");
      await expect(brave.searchWeb({ query: "test" })).rejects.toThrow(/Brave search 502/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("clamps count above max when calling API", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({ web: { results: [] } }), cap);
    try {
      const brave = await import("../../plugins/web-tools/providers/brave.ts");
      const r = await brave.searchWeb({ query: "x", count: 9999 });
      expect(r.results).toEqual([]);
      expect(cap.url).toContain("count=20");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("passes freshness param to API when provided", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({ web: { results: [] } }), cap);
    try {
      const brave = await import("../../plugins/web-tools/providers/brave.ts");
      await brave.searchWeb({ query: "x", freshness: "pw" });
      expect(cap.url).toContain("freshness=pw");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("normalizes web.results array shape", async () => {
    globalThis.fetch = captureFetch(okJson({
      web: {
        results: [
          { title: "T1", url: "https://a.com", description: "d1", age: "1d", score: 0.9 },
          { title: "T2", url: "https://b.com", description: "d2" },
        ],
      },
    }), {});
    try {
      const brave = await import("../../plugins/web-tools/providers/brave.ts");
      const r = await brave.searchWeb({ query: "x" });
      expect(r.results).toHaveLength(2);
      expect(r.results[0].title).toBe("T1");
      expect(r.results[0].url).toBe("https://a.com");
      expect(r.results[0].snippet).toBe("d1");
      expect(r.results[0].published).toBe("1d");
      expect(r.results[0].score).toBe(0.9);
      expect(r.results[1].title).toBe("T2");
      expect(r.metadata.provider).toBe("brave");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("tavily direct HTTPS contract", () => {
  test("fails cleanly when TAVILY_API_KEY is missing", async () => {
    const saved = process.env.TAVILY_API_KEY;
    setKey("TAVILY_API_KEY", undefined);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      await expect(tavily.searchWeb({ query: "x" })).rejects.toThrow(/TAVILY_API_KEY/);
    } finally {
      setKey("TAVILY_API_KEY", saved);
    }
  });

  test("sends Authorization: Bearer header, never URL", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({ results: [] }), cap);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      await tavily.searchWeb({ query: "test" });
      expect(cap.url).not.toContain(TAVILY_KEY);
      const h = new Headers(cap.headers);
      expect(h.get("Authorization")).toBe(`Bearer ${TAVILY_KEY}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects non-array urls in fetchContent", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: "not-an-array" })).rejects.toThrow(/array/);
  });

  test("rejects empty urls in fetchContent", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: [] })).rejects.toThrow(/at least one/);
  });

  test("rejects more than 5 urls in fetchContent", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    await expect(tavily.fetchContent({ urls })).rejects.toThrow(/at most 5/);
  });

  test("rejects loopback URL in fetchContent", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["http://localhost/"] })).rejects.toThrow();
  });

  test("rejects private IP in fetchContent", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["http://10.0.0.5/"] })).rejects.toThrow();
  });

  test("rejects metadata service URL in fetchContent", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["http://metadata.google.internal/"] })).rejects.toThrow();
  });

  test("rejects URL starting with '-'", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["--evil"] })).rejects.toThrow();
  });

  test("throws sanitized error on non-200 search response", async () => {
    globalThis.fetch = captureFetch(
      new Response("upstream error body", { status: 429, statusText: "Too Many Requests" }),
      {},
    );
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      await expect(tavily.searchWeb({ query: "x" })).rejects.toThrow(/Tavily \/search 429/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchWeb normalizes results array shape", async () => {
    globalThis.fetch = captureFetch(okJson({
      results: [
        { title: "T1", url: "https://a.com", content: "body1", score: 0.8, published_date: "2026-06-01" },
        { title: "T2", url: "https://b.com", content: "body2" },
      ],
    }), {});
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      const r = await tavily.searchWeb({ query: "x" });
      expect(r.results).toHaveLength(2);
      expect(r.results[0].title).toBe("T1");
      expect(r.results[0].snippet).toBe("body1");
      expect(r.results[0].published).toBe("2026-06-01");
      expect(r.results[0].score).toBe(0.8);
      expect(r.metadata.provider).toBe("tavily");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchWeb clamps count above max", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({ results: [] }), cap);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      await tavily.searchWeb({ query: "x", count: 9999 });
      const body = JSON.parse(cap.body);
      expect(body.max_results).toBe(20);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetchContent extract mode posts to /extract with urls array", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({
      results: [{ url: "https://a.com", title: "A", raw_content: "content" }],
    }), cap);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      const r = await tavily.fetchContent({ urls: ["https://a.com"], mode: "extract" });
      expect(cap.url).toContain("/extract");
      const body = JSON.parse(cap.body);
      expect(body.urls).toEqual(["https://a.com/"]);
      expect(body.format).toBe("markdown");
      expect(r.results[0].url).toBe("https://a.com");
      expect(r.results[0].title).toBe("A");
      expect(r.results[0].content).toBe("content");
      expect(r.metadata.provider).toBe("tavily");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetchContent crawl mode posts to /crawl with single seed url", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({
      results: [{ url: "https://seed.com/page1", title: "P1", raw_content: "x" }],
    }), cap);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      const r = await tavily.fetchContent({ urls: ["https://seed.com", "https://other.com"], mode: "crawl" });
      expect(cap.url).toContain("/crawl");
      const body = JSON.parse(cap.body);
      expect(body.url).toBe("https://seed.com/");
      expect(r.results[0].url).toBe("https://seed.com/page1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetchContent map mode posts to /map and normalizes results without content", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({
      results: [
        { url: "https://seed.com/p1" },
        { url: "https://seed.com/p2", title: "P2" },
      ],
    }), cap);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      const r = await tavily.fetchContent({ urls: ["https://seed.com"], mode: "map" });
      expect(cap.url).toContain("/map");
      const body = JSON.parse(cap.body);
      expect(body.url).toBe("https://seed.com/");
      expect(r.results).toHaveLength(2);
      expect(r.results[0].url).toBe("https://seed.com/p1");
      expect(r.results[0].content).toBeUndefined();
      expect(r.results[1].title).toBe("P2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchWeb with freshness translates to days in body", async () => {
    const cap = {};
    globalThis.fetch = captureFetch(okJson({ results: [] }), cap);
    try {
      const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
      await tavily.searchWeb({ query: "x", freshness: "pw" });
      const body = JSON.parse(cap.body);
      expect(body.days).toBe(7);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("gemini URL safety (regression)", () => {
  test("fetchContent rejects loopback URL", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: ["http://localhost/"] })).rejects.toThrow();
  });

  test("fetchContent rejects private IP", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: ["http://192.168.1.1/"] })).rejects.toThrow();
  });

  test("fetchContent rejects metadata service", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: ["http://169.254.169.254/latest/meta-data/"] })).rejects.toThrow();
  });

  test("fetchContent rejects more than 5 URLs", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    await expect(gemini.fetchContent({ urls })).rejects.toThrow();
  });

  test("fetchContent rejects empty urls", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: [] })).rejects.toThrow();
  });
});
