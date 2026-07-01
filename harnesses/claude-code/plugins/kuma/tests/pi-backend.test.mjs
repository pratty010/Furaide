import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createPiBackend } from "../scripts/lib/pi-backend.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, "fixtures")

async function withFakePiOnPath(fn) {
  const originalPath = process.env.PATH
  process.env.PATH = `${fixturesDir}${path.delimiter}${originalPath}`
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
  }
}

test("listModels parses the fake pi's model listing", async () => {
  await withFakePiOnPath(async () => {
    const backend = createPiBackend()
    const models = await backend.listModels()
    assert.deepEqual(models, [
      { provider: "opencode-go", model: "deepseek-v4-pro" },
      { provider: "opencode", model: "big-pickle" },
      { provider: "anthropic", model: "claude-sonnet" },
    ])
  })
})

test("sendPrompt captures the fake pi's JSON-lines events", async () => {
  await withFakePiOnPath(async () => {
    const backend = createPiBackend()
    const result = await backend.sendPrompt({
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      prompt: "test",
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].text, "done")
  })
})

test("getAuthStatuses reflects OPENCODE_API_KEY presence", async () => {
  const backend = createPiBackend()
  const previous = process.env.OPENCODE_API_KEY
  delete process.env.OPENCODE_API_KEY
  try {
    const status = await backend.getAuthStatuses()
    assert.equal(status.available, false)
  } finally {
    if (previous !== undefined) process.env.OPENCODE_API_KEY = previous
  }
})

test("cancel delegates to terminateProcessTree and handles a non-finite pid", async () => {
  const backend = createPiBackend()
  const result = await backend.cancel(Number.NaN)
  assert.equal(result.attempted, false)
})
