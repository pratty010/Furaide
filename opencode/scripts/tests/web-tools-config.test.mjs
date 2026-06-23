import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("web-tools config loads defaults when file is missing", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const config = await loadWebToolsConfig({ configDir: "/tmp/does-not-exist" });

  expect(config.webSearch.defaultProvider).toBe("brave");
  expect(config.fetchContent.defaultProvider).toBe("gemini");
  expect(config.mapsSearch.defaultProvider).toBe("gemini");
});

test("default google.transport is auto when config file is missing", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const config = await loadWebToolsConfig({ configDir: "/tmp/does-not-exist" });
  expect(config.google.transport).toBe("auto");
});

test("user setting google.transport to vertex is preserved", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: vertex\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("vertex");
});

test("user setting google.transport to ai-studio is preserved", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: ai-studio\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("ai-studio");
});

test("invalid google.transport value clamps to auto", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: garbage\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("auto");
});

test("non-string google.transport clamps to auto", async () => {
  const { loadWebToolsConfig } = await import("../../plugins/web-tools/config.ts");
  const dir = mkdtempSync(join(tmpdir(), "wt-google-"));
  writeFileSync(join(dir, "web-tools.yml"), "google:\n  transport: 123\n");
  const config = await loadWebToolsConfig({ configDir: dir });
  expect(config.google.transport).toBe("auto");
});
