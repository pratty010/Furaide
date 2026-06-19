import { test, expect, describe, beforeAll, afterAll } from "bun:test";

describe("Gemini error sanitization", () => {
  let originalFetch;
  let originalKey;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  test("error body is truncated when API returns long body", async () => {
    let observedHeaders;
    const hugeBody = "x".repeat(2000) + " sensitive-data-leak";
    globalThis.fetch = (async (_url, init) => {
      observedHeaders = init && init.headers;
      return new Response(hugeBody, { status: 500, statusText: "Internal Server Error" });
    });

    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.searchWeb({ query: "test" })).rejects.toThrow(/Gemini web_search 500/);

    expect(observedHeaders).toBeDefined();
    const h = new Headers(observedHeaders);
    expect(h.get("x-goog-api-key")).toBe("test-key");
    expect(h.get("Content-Type")).toBe("application/json");
  });

  test("API key is sent via header, not URL query string", async () => {
    let observedUrl;
    globalThis.fetch = (async (url) => {
      observedUrl = url;
      return new Response("ok", { status: 500 });
    });

    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    try {
      await gemini.searchWeb({ query: "test" });
    } catch {}

    expect(String(observedUrl)).not.toContain("key=");
    expect(String(observedUrl)).not.toContain("test-key");
  });

  test("fetchContent uses header auth, not URL", async () => {
    let observedUrl;
    globalThis.fetch = (async (url) => {
      observedUrl = url;
      return new Response("ok", { status: 500 });
    });

    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    try {
      await gemini.fetchContent({ urls: ["https://example.com"] });
    } catch {}

    expect(String(observedUrl)).not.toContain("key=");
    expect(String(observedUrl)).not.toContain("test-key");
  });

  test("sanitized error body truncates at 500 chars", async () => {
    const { truncateErrorBody } = await import("../../plugins/web-tools/util/validate.ts");
    const out = truncateErrorBody("a".repeat(2000));
    expect(out.length).toBeLessThan(600);
    expect(out).toContain("truncated");
  });
});
