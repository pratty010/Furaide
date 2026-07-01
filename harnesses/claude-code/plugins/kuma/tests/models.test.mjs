import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeBackendListings, enrichWithBaseLlm, saveModelIndex, loadModelIndex } from "../scripts/lib/models.mjs";

test("mergeBackendListings drops unsupported providers", () => {
  const merged = mergeBackendListings({
    opencodeModels: [{ provider: "anthropic", model: "claude" }, { provider: "opencode-go", model: "deepseek-v4-pro" }]
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].provider, "opencode-go");
});

test("mergeBackendListings marks backend as 'both' when both list the same provider/model", () => {
  const merged = mergeBackendListings({
    opencodeModels: [{ provider: "opencode-go", model: "deepseek-v4-pro" }],
    piModels: [{ provider: "opencode-go", model: "deepseek-v4-pro" }]
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].backend, "both");
});

test("enrichWithBaseLlm maps display-name vendor to slug and parses tags", () => {
  const enriched = enrichWithBaseLlm(
    [{ model: "deepseek-v4-pro", provider: "opencode-go", backend: "opencode", capabilities: null, context: null, status: "available" }],
    [{ model_name: "deepseek-v4-pro", vendor_name: "OpenCode Go", tags: "Reasoning,Tools,128K" }]
  );
  assert.equal(enriched[0].context, "128K");
  assert.equal(enriched[0].capabilities, "Reasoning,Tools");
});

test("saveModelIndex/loadModelIndex round-trip per workspace", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-models-test-"));
  process.env.KUMA_PLUGIN_DATA = dir;
  try {
    saveModelIndex("/tmp/workspace-a", [{ model: "x", provider: "opencode-go", backend: "opencode", status: "available" }]);
    const loaded = loadModelIndex("/tmp/workspace-a");
    assert.equal(loaded.entries.length, 1);
  } finally {
    delete process.env.KUMA_PLUGIN_DATA;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
