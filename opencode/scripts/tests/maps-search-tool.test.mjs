import { test, expect } from "bun:test";

test("maps_search returns gemini-backed lean results with optional placeId", async () => {
  const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");

  const testRuntime = {
    config: {
      mapsSearch: {
        defaultProvider: "gemini",
        count: 5,
      },
    },
    providers: {
      searchMaps: async () => ({
        results: [
          { title: "Cafe de Flore", uri: "https://maps.google.com/?cid=123", placeId: "ChIJ123" },
          { title: "Blue Bottle Coffee", uri: "https://maps.google.com/?cid=456" },
        ],
        metadata: { provider: "gemini", latencyMs: 300 },
      }),
    },
  };

  const result = await executeMapsSearchTool({ query: "coffee near Shibuya", count: 3 }, testRuntime);

  expect(result.results).toHaveLength(2);
  expect(result.results[0]).toEqual({
    title: "Cafe de Flore",
    uri: expect.stringContaining("http"),
    placeId: "ChIJ123",
  });
  expect(result.results[1]).toEqual({
    title: "Blue Bottle Coffee",
    uri: expect.stringContaining("http"),
  });

  const resultJson = JSON.stringify(result);
  expect(resultJson).not.toContain("provider");
  expect(resultJson).not.toContain("latencyMs");
});

test("maps_search applies config defaults when args omitted", async () => {
  const { normalizeMapsSearchArgs } = await import("../../plugins/web-tools/tools/maps-search.ts");

  const config = {
    defaultProvider: "gemini",
    count: 10,
  };

  const normalized = normalizeMapsSearchArgs({ query: "restaurants in Tokyo" }, config);
  expect(normalized.count).toBe(10);
  expect(normalized.query).toBe("restaurants in Tokyo");
});
