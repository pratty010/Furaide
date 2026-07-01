import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionPath = path.join(__dirname, "..", "scripts", "kuma-companion.mjs");

function runCli(args, env = {}) {
  return spawnSync("node", [companionPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Usage:"));
});

test("models prints a hint when no index is cached", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-cli-test-"));
  try {
    const result = runCli(["models"], { KUMA_PLUGIN_DATA: dir });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("No model index cached yet"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("status prints a message when no jobs are recorded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-cli-test-"));
  try {
    const result = runCli(["status"], { KUMA_PLUGIN_DATA: dir });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("No jobs recorded"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("task fails clearly when no backend/model default is configured", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-cli-test-"));
  try {
    const result = runCli(["task", "do something"], { KUMA_PLUGIN_DATA: dir });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes("/kuma:setup"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("review fails clearly when no backend/model default is configured", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-cli-test-"));
  try {
    const result = runCli(["review"], { KUMA_PLUGIN_DATA: dir });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes("/kuma:setup"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
