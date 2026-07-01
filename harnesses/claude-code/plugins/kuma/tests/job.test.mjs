import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJob, markRunning, markDone, markError, markCancelled, isJobActive } from "../scripts/lib/job.mjs";
import { listJobs } from "../scripts/lib/state.mjs";

function withTempPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-job-test-"));
  process.env.KUMA_PLUGIN_DATA = dir;
  try {
    fn(dir);
  } finally {
    delete process.env.KUMA_PLUGIN_DATA;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("createJob starts queued and isJobActive is true", () => {
  withTempPluginData(() => {
    const job = createJob("/tmp/workspace-a", { kind: "task", provider: "opencode-go", model: "kimi-k2.6", backend: "opencode" });
    assert.equal(job.status, "queued");
    assert.equal(isJobActive(job), true);
  });
});

test("markRunning -> markDone transitions to done with a result", () => {
  withTempPluginData(() => {
    const job = createJob("/tmp/workspace-a", { kind: "task", provider: "opencode-go", model: "kimi-k2.6", backend: "opencode" });
    markRunning("/tmp/workspace-a", job.id, { pid: 12345 });
    markDone("/tmp/workspace-a", job.id, { result: { text: "done" } });
    const stored = listJobs("/tmp/workspace-a").find((j) => j.id === job.id);
    assert.equal(stored.status, "done");
    assert.equal(stored.pid, null);
    assert.deepEqual(stored.result, { text: "done" });
  });
});

test("markError and markCancelled set the expected terminal status", () => {
  withTempPluginData(() => {
    const jobA = createJob("/tmp/workspace-a", { kind: "review", provider: "opencode", model: "gpt-5.4", backend: "opencode" });
    markError("/tmp/workspace-a", jobA.id, { errorMessage: "boom" });
    assert.equal(listJobs("/tmp/workspace-a").find((j) => j.id === jobA.id).status, "error");

    const jobB = createJob("/tmp/workspace-a", { kind: "task", provider: "opencode-go", model: "deepseek-v4-pro", backend: "opencode" });
    markCancelled("/tmp/workspace-a", jobB.id);
    assert.equal(listJobs("/tmp/workspace-a").find((j) => j.id === jobB.id).status, "cancelled");
  });
});
