import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackend } from "../scripts/lib/backend.mjs";

test("createBackend returns the opencode adapter", () => {
  const backend = createBackend("opencode");
  assert.equal(typeof backend.listModels, "function");
  assert.equal(typeof backend.sendPrompt, "function");
});

test("createBackend returns the pi adapter", () => {
  const backend = createBackend("pi");
  assert.equal(typeof backend.listModels, "function");
  assert.equal(typeof backend.sendPrompt, "function");
});

test("createBackend throws on an unknown backend name", () => {
  assert.throws(() => createBackend("nope"), /Unknown backend/);
});
