import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test";

// ── Vertex auth mock ──────────────────────────────────────────
// Mock the vertex-auth module directly so we don't need the real
// google-auth-library package installed. Returning a fixed fake token
// matches the real shape (string) and avoids the static-import
// resolution that fails when the package is absent.
mock.module("../../plugins/tools/web-tools/providers/vertex-auth.ts", () => ({
  getVertexAccessToken: async () => "fake-token",
}));

// ── AI Studio transport ───────────────────────────────────────
describe("AI Studio transport", () => {
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

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
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

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
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

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
    try {
      await gemini.fetchContent({ urls: ["https://example.com"] });
    } catch {}

    expect(String(observedUrl)).not.toContain("key=");
    expect(String(observedUrl)).not.toContain("test-key");
  });
});

// ── Vertex transport ──────────────────────────────────────────
describe("Vertex transport", () => {
  let origFetch;
  let origProject;
  let origLocation;
  let origCreds;
  let origKey;

  beforeAll(() => {
    origFetch = globalThis.fetch;
    origProject = process.env.GOOGLE_CLOUD_PROJECT;
    origLocation = process.env.GOOGLE_CLOUD_LOCATION;
    origCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    origKey = process.env.GEMINI_API_KEY;

    process.env.GOOGLE_CLOUD_PROJECT = "test-proj";
    process.env.GOOGLE_CLOUD_LOCATION = "global";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-credentials.json";
  });

  afterAll(() => {
    globalThis.fetch = origFetch;
    if (origProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = origProject;
    if (origLocation === undefined) delete process.env.GOOGLE_CLOUD_LOCATION;
    else process.env.GOOGLE_CLOUD_LOCATION = origLocation;
    if (origCreds === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = origCreds;
    if (origKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origKey;
  });

  test("Vertex searchWeb uses AI Platform endpoint and Bearer auth", async () => {
    let capturedUrl, capturedHeaders, capturedBody;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      capturedBody = init?.body;
      return new Response(
        JSON.stringify({
          candidates: [{ groundingMetadata: { groundingChunks: [] } }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
        }),
        { status: 200 },
      );
    };

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
    await gemini.searchWeb({ query: "test", transport: "vertex" });

    expect(String(capturedUrl)).toStartWith("https://aiplatform.googleapis.com");
    const h = new Headers(capturedHeaders);
    expect(h.get("Authorization")).toBe("Bearer fake-token");
    const body = JSON.parse(capturedBody);
    expect(body.tools[0]).toHaveProperty("googleSearch");

    globalThis.fetch = origFetch;
  });

  test("Vertex searchMaps includes latLng in request body", async () => {
    let capturedBody;
    globalThis.fetch = async (url, init) => {
      capturedBody = init?.body;
      return new Response(
        JSON.stringify({
          candidates: [{ groundingMetadata: { groundingChunks: [] } }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
        }),
        { status: 200 },
      );
    };

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
    await gemini.searchMaps({
      query: "restaurants near Shibuya",
      lat: 35.6595,
      lng: 139.7004,
      transport: "vertex",
    });

    const body = JSON.parse(capturedBody);
    expect(body.toolConfig.retrievalConfig.latLng).toEqual({ latitude: 35.6595, longitude: 139.7004 });
    expect(body.contents[0].parts[0].text).not.toContain("(near 35.6595");

    globalThis.fetch = origFetch;
  });

  test("Vertex region uses regional endpoint", async () => {
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

    let capturedUrl;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          candidates: [{ groundingMetadata: { groundingChunks: [] } }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
        }),
        { status: 200 },
      );
    };

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
    await gemini.searchWeb({ query: "test", transport: "vertex" });

    expect(String(capturedUrl)).toStartWith("https://us-central1-aiplatform.googleapis.com");

    globalThis.fetch = origFetch;
    process.env.GOOGLE_CLOUD_LOCATION = "global";
  });

  test("Vertex searchMaps sends bare googleMaps tool and parses maps chunks", async () => {
    let capturedBody;
    globalThis.fetch = async (url, init) => {
      capturedBody = init?.body;
      return new Response(
        JSON.stringify({
          candidates: [{
            groundingMetadata: {
              groundingChunks: [
                {
                  maps: {
                    uri: "https://maps.google.com/?cid=123",
                    title: "Shibuya Cafe",
                    placeId: "places/ChIJ123abc",
                  },
                },
                {
                  maps: {
                    uri: "https://maps.google.com/?cid=456",
                    title: "Shibuya Ramen",
                    placeId: "places/ChIJ456def",
                  },
                },
              ],
            },
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        }),
        { status: 200 },
      );
    };

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
    const result = await gemini.searchMaps({
      query: "coffee shops in Shibuya",
      lat: 35.6595,
      lng: 139.7004,
      transport: "vertex",
    });

    // Request body assertions
    const body = JSON.parse(capturedBody);
    expect(body.tools[0].googleMaps).toEqual({});
    expect(body.toolConfig.retrievalConfig.latLng).toEqual({ latitude: 35.6595, longitude: 139.7004 });

    // Response parsing assertions
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: "Shibuya Cafe",
      uri: "https://maps.google.com/?cid=123",
      placeId: "places/ChIJ123abc",
    });
    expect(result.results[1].placeId).toBe("places/ChIJ456def");

    globalThis.fetch = origFetch;
  });
});

// ── AI Studio maps chunk parsing ──────────────────────────────
describe("AI Studio maps chunk parsing", () => {
  let origFetch;
  let origKey;

  beforeAll(() => {
    origFetch = globalThis.fetch;
    origKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterAll(() => {
    globalThis.fetch = origFetch;
    if (origKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origKey;
  });

  test("AI Studio searchMaps parses groundingChunks[].maps into title/uri/placeId", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{
            groundingMetadata: {
              groundingChunks: [
                {
                  maps: {
                    uri: "https://maps.google.com/?cid=999",
                    title: "Senso-ji",
                    placeId: "places/ChIJ999xyz",
                  },
                },
              ],
            },
          }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
        }),
        { status: 200 },
      );

    const gemini = await import("../../plugins/tools/web-tools/providers/gemini.ts");
    const result = await gemini.searchMaps({
      query: "famous temples in Asakusa",
      transport: "ai-studio",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      title: "Senso-ji",
      uri: "https://maps.google.com/?cid=999",
      placeId: "places/ChIJ999xyz",
    });
  });
});

// ── Utility: error sanitization ────────────────────────────────
describe("Utility: error sanitization", () => {
  test("sanitized error body truncates at 500 chars", async () => {
    const { truncateErrorBody } = await import("../../plugins/tools/web-tools/util/validate.ts");
    const out = truncateErrorBody("a".repeat(2000));
    expect(out.length).toBeLessThan(600);
    expect(out).toContain("truncated");
  });
});
