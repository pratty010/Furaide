import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("validateConfig", () => {
  test("returns defaults for non-object input", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig(null);
    expect(cfg.webSearch.defaultProvider).toBe("brave");
    expect(cfg.budgets.geminiUsd).toBe(5.0);
  });

  test("filters unknown providers from fallback order", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig({
      webSearch: {
        primaryFallbackOrder: ["brave", "evil", "tavily", 42, "gemini"],
      },
    });
    expect(cfg.webSearch.primaryFallbackOrder).toEqual(["brave", "tavily", "gemini"]);
  });

  test("rejects unknown defaultProvider", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig({
      webSearch: { defaultProvider: "evil-search" },
    });
    expect(cfg.webSearch.defaultProvider).toBe("brave");
  });

  test("clamps count to [1, 20]", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    expect(validateConfig({ webSearch: { count: 999 } }).webSearch.count).toBe(20);
    expect(validateConfig({ webSearch: { count: 0 } }).webSearch.count).toBe(1);
    expect(validateConfig({ webSearch: { count: 7 } }).webSearch.count).toBe(7);
  });

  test("clamps negative budgets to 0", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig({ budgets: { geminiUsd: -5, braveRequests: -1 } });
    expect(cfg.budgets.geminiUsd).toBe(0);
    expect(cfg.budgets.braveRequests).toBe(0);
  });

  test("rejects unknown freshness value", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig({ webSearch: { freshness: "hour" } });
    expect(cfg.webSearch.freshness).toBe("pm");
  });

  test("rejects unknown format", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig({ fetchContent: { format: "html" } });
    expect(cfg.fetchContent.format).toBe("markdown");
  });

  test("clamps TTL and accepts cache.maxEntries", async () => {
    const { validateConfig } = await import("../../plugins/web-tools/config.ts");
    const cfg = validateConfig({
      cache: { ttl: { webSearchMs: -1, fetchContentMs: 5_000 }, maxEntries: 1024 },
    });
    expect(cfg.cache.ttl.webSearchMs).toBe(0);
    expect(cfg.cache.ttl.fetchContentMs).toBe(5_000);
    expect(cfg.cache.maxEntries).toBe(1024);
  });

  test("loadWebToolsConfig tolerates malformed yaml", async () => {
    const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
    const dir = mkdtempSync(join(tmpdir(), "wt-cfg-"));
    try {
      writeFileSync(join(dir, "web-tools.yml"), "this: is: not: valid: yaml: ::");
      const cfg = await loadWebToolsConfig({ configDir: dir });
      expect(cfg.webSearch.defaultProvider).toBe("brave");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadWebToolsConfig applies validation on loaded file", async () => {
    const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
    const dir = mkdtempSync(join(tmpdir(), "wt-cfg-"));
    try {
      writeFileSync(
        join(dir, "web-tools.yml"),
        "webSearch:\n  count: 999\n  primaryFallbackOrder: [evil, brave]\nbudgets:\n  geminiUsd: -10\n",
      );
      const cfg = await loadWebToolsConfig({ configDir: dir });
      expect(cfg.webSearch.count).toBe(20);
      expect(cfg.webSearch.primaryFallbackOrder).toContain("brave");
      expect(cfg.webSearch.primaryFallbackOrder).not.toContain("evil");
      expect(cfg.budgets.geminiUsd).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
