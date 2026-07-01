import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpencodeBackend } from "../scripts/lib/opencode-backend.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

async function withFakeOpencodeOnPath(fn) {
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixturesDir}${path.delimiter}${originalPath}`;
  try {
    await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

test("listModels parses the fake opencode's model listing", async () => {
  await withFakeOpencodeOnPath(async () => {
    const backend = createOpencodeBackend();
    const models = await backend.listModels();
    assert.deepEqual(models, [
      { provider: "opencode-go", model: "deepseek-v4-pro" },
      { provider: "opencode", model: "big-pickle" },
      { provider: "anthropic", model: "claude" }
    ]);
  });
});

test("sendPrompt captures the fake opencode's stdout as rawOutput", async () => {
  await withFakeOpencodeOnPath(async () => {
    const backend = createOpencodeBackend();
    const result = await backend.sendPrompt({ provider: "opencode-go", model: "deepseek-v4-pro", prompt: "test" });
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.rawOutput);
    assert.equal(parsed.verdict, "approve");
  });
});

test("cancel delegates to terminateProcessTree and handles a non-finite pid", async () => {
  const backend = createOpencodeBackend();
  const result = await backend.cancel(Number.NaN);
  assert.equal(result.attempted, false);
});
