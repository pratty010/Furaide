import assert from "node:assert/strict"
import { test } from "node:test"
import { binaryAvailable, terminateProcessTree } from "../scripts/lib/process.mjs"

test("binaryAvailable reports unavailable for a nonexistent command", () => {
  const result = binaryAvailable("kuma-definitely-not-a-real-binary")
  assert.equal(result.available, false)
})

test("terminateProcessTree returns attempted:false for a non-finite pid", () => {
  const result = terminateProcessTree(Number.NaN)
  assert.deepEqual(result, { attempted: false, delivered: false, method: null })
})

test("terminateProcessTree falls back to killing the pid when process-group kill gets ESRCH", () => {
  const calls = []
  const result = terminateProcessTree(123, {
    platform: "linux",
    killImpl(target, signal) {
      calls.push([target, signal])
      if (target === -123) {
        const error = new Error("missing group")
        error.code = "ESRCH"
        throw error
      }
    },
  })

  assert.deepEqual(calls, [
    [-123, "SIGTERM"],
    [123, "SIGTERM"],
  ])
  assert.equal(result.delivered, true)
  assert.equal(result.method, "process")
})

test("terminateProcessTree reports undelivered when both process-group and pid are missing", () => {
  const result = terminateProcessTree(123, {
    platform: "linux",
    killImpl() {
      const error = new Error("missing")
      error.code = "ESRCH"
      throw error
    },
  })

  assert.equal(result.delivered, false)
  assert.equal(result.method, "process-group")
})
