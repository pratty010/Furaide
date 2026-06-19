import { test, expect } from "bun:test";

test("web-tools config loads defaults when file is missing", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const config = await loadWebToolsConfig({ configDir: "/tmp/does-not-exist" });

  expect(config.webSearch.defaultProvider).toBe("brave");
  expect(config.fetchContent.defaultProvider).toBe("gemini");
  expect(config.mapsSearch.defaultProvider).toBe("gemini");
});
