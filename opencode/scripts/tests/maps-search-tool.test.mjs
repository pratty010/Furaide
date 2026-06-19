import { test, expect, describe } from "bun:test";

test("maps_search tool executes with mock runtime", async () => {
  const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");

  const mockRuntime = {
    config: {
      mapsSearch: {
        defaultProvider: "gemini",
        count: 3,
      },
    },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchMaps: async () => ({
        results: [
          { title: "Starbucks Shibuya", uri: "https://maps.google.com/?cid=123", placeId: "123" },
          { title: "Tully's Coffee", uri: "https://maps.google.com/?cid=456" },
        ],
        metadata: { provider: "gemini", latencyMs: 200 },
      }),
    },
    recordWithBudget: async () => null,
  };

  const result = await executeMapsSearchTool({ query: "coffee near Shibuya", count: 3 }, mockRuntime);
  expect(result.results).toHaveLength(2);
  expect(result.results[0].title).toBe("Starbucks Shibuya");
  expect(result.results[0].uri).toContain("http");
  expect(result.results[0].placeId).toBe("123");
  expect(result.results[1].placeId).toBeUndefined();
});

test("maps_search returns lean fields only", async () => {
  const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");

  const mockRuntime = {
    config: {
      mapsSearch: { defaultProvider: "gemini", count: 5 },
    },
    usage: { recordFromSearch: async () => {} },
    providers: {
      searchMaps: async () => ({
        results: [{ title: "Place", uri: "https://maps.google.com/" }],
        metadata: { provider: "gemini", latencyMs: 100, unitsUsed: 1 },
      }),
    },
    recordWithBudget: async () => null,
  };

  const result = await executeMapsSearchTool({ query: "test" }, mockRuntime);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("provider");
  expect(serialized).not.toContain("latencyMs");
  expect(serialized).not.toContain("unitsUsed");
});

test("maps_search applies default count from config", async () => {
  const { normalizeMapsSearchArgs } = await import("../../plugins/web-tools/tools/maps-search.ts");

  const config = { defaultProvider: "gemini", count: 7 };
  const normalized = normalizeMapsSearchArgs({ query: "sushi" }, config);
  expect(normalized.count).toBe(7);

  const withOverride = normalizeMapsSearchArgs({ query: "ramen", count: 3 }, config);
  expect(withOverride.count).toBe(3);
});

describe("maps_search lat/lng propagation", () => {
  test("passes lat/lng to provider", async () => {
    const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");

    let receivedLat;
    let receivedLng;
    const mockRuntime = {
      config: { mapsSearch: { defaultProvider: "gemini", count: 3 } },
      usage: { recordFromSearch: async () => {} },
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
      recordWithBudget: async () => null,
    };

    await executeMapsSearchTool({ query: "cafe", lat: 35.6762, lng: 139.6503 }, mockRuntime);
    expect(receivedLat).toBe(35.6762);
    expect(receivedLng).toBe(139.6503);
  });

  test("passes undefined lat/lng when not provided", async () => {
    const { executeMapsSearchTool } = await import("../../plugins/web-tools/tools/maps-search.ts");

    let receivedLat;
    let receivedLng;
    const mockRuntime = {
      config: { mapsSearch: { defaultProvider: "gemini", count: 3 } },
      usage: { recordFromSearch: async () => {} },
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
      recordWithBudget: async () => null,
    };

    await executeMapsSearchTool({ query: "cafe" }, mockRuntime);
    expect(receivedLat).toBeUndefined();
    expect(receivedLng).toBeUndefined();
  });
});
