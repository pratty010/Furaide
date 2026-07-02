import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("web-tools config loads defaults when file is missing", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const config = await loadWebToolsConfig({ configDir: "/tmp/does-not-exist" });

  expect(config.webSearch.defaultProvider).toBe("brave");
  expect(config.fetchContent.defaultProvider).toBe("gemini");
  expect(config.mapsSearch.defaultProvider).toBe("gemini");
});

test("default google.transport is auto when config file is missing", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const config = await loadWebToolsConfig({ configDir: "/tmp/does-not-exist" });
  expect(config.google.transport).toBe("auto");
});

test("user setting google.transport to vertex is preserved", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: vertex\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("vertex");
});

test("user setting google.transport to ai-studio is preserved", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: ai-studio\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("ai-studio");
});

test("invalid google.transport value clamps to auto", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: garbage\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("auto");
});

test("non-string google.transport clamps to auto", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: 123\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("auto");
});

test("advanced defaults present for webSearch and fetchContent", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const config = await loadWebToolsConfig({ configDir: "/tmp/does-not-exist" });
  expect(config.webSearch.advanced.depth).toBe("simple");
  expect(config.webSearch.advanced.topic).toBe("general");
  expect(config.webSearch.advanced.minScore).toBe(0);
  expect(config.webSearch.advanced.includeDomains).toEqual([]);
  expect(config.webSearch.advanced.excludeDomains).toEqual([]);
  expect(config.webSearch.advanced.country).toBe("");
  expect(config.webSearch.advanced.includeImages).toBe(false);
  expect(config.webSearch.advanced.highlights).toBe(false);
  expect(config.webSearch.advanced.braveGoggles).toEqual([]);
  expect(config.fetchContent.advanced.depth).toBe(2);
  expect(config.fetchContent.advanced.maxChars).toBe(100000);
  expect(config.fetchContent.advanced.maxDepth).toBe(2);
  expect(config.fetchContent.advanced.limit).toBe(10);
  expect(config.fetchContent.advanced.selectPaths).toEqual([]);
  expect(config.fetchContent.advanced.query).toBe("");
  expect(config.fetchContent.advanced.chunksPerSource).toBe(0);
});

test("user override depth under fetchContent.advanced", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "fetchContent:\n  advanced:\n    depth: 2\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.fetchContent.advanced.depth).toBe(2);
});

test("user override topic=garbage clamps to general", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "webSearch:\n  advanced:\n    topic: garbage\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.webSearch.advanced.topic).toBe("general");
});

test("user override minScore=2 clamps to 1", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "webSearch:\n  advanced:\n    minScore: 2\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.webSearch.advanced.minScore).toBe(1);
});

test("user override maxChars=99999999 clamps to 1_000_000", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "fetchContent:\n  advanced:\n    maxChars: 99999999\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.fetchContent.advanced.maxChars).toBe(1_000_000);
});

test("user override depth=999 clamps to 10", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "fetchContent:\n  advanced:\n    depth: 999\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.fetchContent.advanced.depth).toBe(10);
});

test("includeDomains preserves unique non-empty", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "webSearch:\n  advanced:\n    includeDomains: [\"foo.com\"]\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.webSearch.advanced.includeDomains).toEqual(["foo.com"]);
});

test("includeDomains filters empty and trims duplicates", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "webSearch:\n  advanced:\n    includeDomains: [\"\", \" foo.com \", \"foo.com\", \"foo.com\"]\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.webSearch.advanced.includeDomains).toEqual(["foo.com"]);
});

test("country trims to empty string when only whitespace", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/tools/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-adv-"));
  writeFileSync(join(dir, "web-tools.yml"), "webSearch:\n  advanced:\n    country: \" \"\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.webSearch.advanced.country).toBe("");
});
