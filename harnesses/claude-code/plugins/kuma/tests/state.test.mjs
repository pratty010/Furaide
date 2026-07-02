import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  getConfig,
  listJobs,
  resolveStateDir,
  resolveStateFile,
  saveState,
  setConfig,
  upsertJob,
} from "../scripts/lib/state.mjs"

function withTempPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-state-test-"))
  const previous = process.env.KUMA_PLUGIN_DATA
  process.env.KUMA_PLUGIN_DATA = dir
  try {
    fn(dir)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
    else process.env.KUMA_PLUGIN_DATA = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("resolveStateDir differs for two different workspace roots", () => {
  withTempPluginData(() => {
    const dirA = resolveStateDir("/tmp/workspace-a")
    const dirB = resolveStateDir("/tmp/workspace-b")
    assert.notEqual(dirA, dirB)
  })
})

test("upsertJob persists and listJobs reads it back, scoped to the workspace", () => {
  withTempPluginData(() => {
    upsertJob("/tmp/workspace-a", { id: "job-1", kind: "task", status: "queued" })
    const jobsA = listJobs("/tmp/workspace-a")
    const jobsB = listJobs("/tmp/workspace-b")
    assert.equal(jobsA.length, 1)
    assert.equal(jobsA[0].id, "job-1")
    assert.equal(jobsB.length, 0)
  })
})

test("setConfig/getConfig round-trip defaultBackend", () => {
  withTempPluginData(() => {
    setConfig("/tmp/workspace-a", "defaultBackend", "opencode")
    assert.equal(getConfig("/tmp/workspace-a").defaultBackend, "opencode")
  })
})

test("saveState writes atomically without leaving temp files behind", () => {
  withTempPluginData(() => {
    saveState("/tmp/workspace-a", {
      config: { defaultBackend: "opencode", defaultModel: "deepseek-v4-pro" },
      jobs: [{ id: "job-1", kind: "task", status: "queued" }],
    })

    const stateDir = resolveStateDir("/tmp/workspace-a")
    const entries = fs.readdirSync(stateDir)
    assert.ok(entries.includes(path.basename(resolveStateFile("/tmp/workspace-a"))))
    assert.equal(
      entries.some((entry) => entry.endsWith(".tmp")),
      false
    )
  })
})
