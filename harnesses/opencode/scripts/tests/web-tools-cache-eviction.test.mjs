import { test, expect, describe } from "bun:test";

describe("InMemoryCache eviction", () => {
  test("caps at maxEntries and evicts oldest", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const cache = new InMemoryCache({ maxEntries: 3 });
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("c", 3, 60_000);
    expect(cache.size).toBe(3);

    cache.set("d", 4, 60_000);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  test("get promotes entry (LRU semantics)", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const cache = new InMemoryCache({ maxEntries: 3 });
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("c", 3, 60_000);

    cache.get("a");
    cache.set("d", 4, 60_000);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  test("set with same key does not evict", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const cache = new InMemoryCache({ maxEntries: 2 });
    cache.set("a", 1, 60_000);
    cache.set("a", 2, 60_000);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  test("default capacity is 256", async () => {
    const { InMemoryCache, DEFAULT_MAX_CACHE_ENTRIES } = await import("../../plugins/tools/web-tools/cache.ts");
    expect(DEFAULT_MAX_CACHE_ENTRIES).toBe(256);
    const cache = new InMemoryCache();
    expect(cache.capacity).toBe(256);
  });

  test("respects custom maxEntries", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const cache = new InMemoryCache({ maxEntries: 50 });
    expect(cache.capacity).toBe(50);
  });

  test("clamps maxEntries to at least 1", async () => {
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const cache = new InMemoryCache({ maxEntries: 0 });
    expect(cache.capacity).toBe(1);
  });
});
