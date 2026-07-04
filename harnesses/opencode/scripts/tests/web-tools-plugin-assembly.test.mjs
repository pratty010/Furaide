import { test, expect, describe, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Plugin runtime assembly", () => {
  let configDir;

  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), "wt-assembly-"));
  });

  test("loadWebToolsConfig returns defaults for missing config", async () => {
    const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
    const config = await loadWebToolsConfig({ configDir });
    expect(config.webSearch.defaultProvider).toBe("brave");
    expect(config.fetchContent.defaultProvider).toBe("gemini");
    expect(config.mapsSearch.defaultProvider).toBe("gemini");
    expect(config.budgets.geminiUsd).toBe(5.0);
    expect(config.cache.ttl.webSearchMs).toBeGreaterThan(0);
  });

  test("loadWebToolsConfig merges user config over defaults", async () => {
    const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
    writeFileSync(join(configDir, "web-tools.yml"), `webSearch:\n  count: 10\nbudgets:\n  geminiUsd: 2.5\n`);
    const config = await loadWebToolsConfig({ configDir });
    expect(config.webSearch.count).toBe(10);
    expect(config.budgets.geminiUsd).toBe(2.5);
    expect(config.webSearch.defaultProvider).toBe("brave");
  });

  test("InMemoryCache accepts TTLs from config", async () => {
    const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const config = await loadWebToolsConfig({ configDir });
    const cache = new InMemoryCache({
      webSearchTtlMs: config.cache.ttl.webSearchMs,
      fetchContentTtlMs: config.cache.ttl.fetchContentMs,
    });
    expect(cache.size).toBe(0);
    cache.set("k", "v", 5000);
    expect(cache.size).toBe(1);
    expect(cache.get("k")).toBe("v");
  });

  test("DB + usage tracker compose correctly", async () => {
    const { openTestDb } = await import("../../plugins/tools/web-tools/db.ts");
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const db = openTestDb();
    const budgets = { geminiUsd: 5.0, braveRequests: 2000, tavilyCredits: 1000 };
    const usage = createUsageTracker(db, budgets);

    await usage.record({ provider: "brave", unitsUsed: 1, estimatedCostUsd: 0, month: "2026-06" });
    const snapshot = await usage.getMonth("brave", "2026-06");
    expect(snapshot.calls).toBe(1);
    expect(snapshot.units_used).toBe(1);
  });

  test("DB + cache + usage compose as a combined runtime", async () => {
    const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
    const { InMemoryCache } = await import("../../plugins/tools/web-tools/cache.ts");
    const { openTestDb, createTables } = await import("../../plugins/tools/web-tools/db.ts");
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const config = await loadWebToolsConfig({ configDir });
    const cache = new InMemoryCache({
      webSearchTtlMs: config.cache.ttl.webSearchMs,
      fetchContentTtlMs: config.cache.ttl.fetchContentMs,
    });
    const db = openTestDb();
    const usage = createUsageTracker(db, config.budgets);

    const runtime = { config, cache, db, usage };

    expect(runtime.config.webSearch.defaultProvider).toBe("brave");
    expect(runtime.cache.size).toBe(0);
    expect(runtime.db).toBeDefined();

    await runtime.usage.record({ provider: "gemini", unitsUsed: 1, estimatedCostUsd: 0.01, month: "2026-06" });
    const snap = await runtime.usage.getMonth("gemini", "2026-06");
    expect(snap.calls).toBe(1);
    expect(snap.estimated_cost_usd).toBeCloseTo(0.01);

    runtime.cache.set("test-key", { results: [] }, 5000);
    expect(runtime.cache.get("test-key")).toEqual({ results: [] });
  });

  test("effectiveOrder dedupes across fallback chains", async () => {
    const { effectiveOrder } = await import("../../plugins/tools/web-tools/order.ts");
    const order = effectiveOrder("brave", ["brave", "tavily", "gemini"], ["brave", "gemini"]);
    expect(order).toEqual(["brave", "tavily", "gemini"]);
  });

  test("searchMaps provider respects budget pre-check", async () => {
    const { openTestDb } = await import("../../plugins/tools/web-tools/db.ts");
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");

    const db = openTestDb();
    const budgets = { geminiUsd: 0.05, braveRequests: 2000, tavilyCredits: 1000 };
    const usage = createUsageTracker(db, budgets);

    await usage.record({ provider: "gemini", unitsUsed: 1, estimatedCostUsd: 0.05, month: "2026-06" });
    const snapshot = await usage.getMonth("gemini", "2026-06");
    const result = checkBudget(budgets, snapshot, "gemini");

    expect(result.blocked).toBe(true);
    expect(result.preamble).toContain("Budget exceeded");
  });
});
