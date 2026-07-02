import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
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

test("sendPrompt caps oversized stdout for pi", async () => {
  await withFakePiOnPath(async () => {
    const backend = createPiBackend()
    const previous = process.env.PI_FIXTURE_OUTPUT_SIZE
    process.env.PI_FIXTURE_OUTPUT_SIZE = "150000"
    try {
      const result = await backend.sendPrompt({
        provider: "opencode-go",
        model: "deepseek-v4-pro",
        prompt: "test",
      })
      assert.equal(result.exitCode, 0)
      assert.match(result.rawOutput, /truncated at 100000 chars/)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "PI_FIXTURE_OUTPUT_SIZE")
      else process.env.PI_FIXTURE_OUTPUT_SIZE = previous
    }
  })
})

test("getAuthStatuses reflects OPENCODE_API_KEY presence", async () => {
  const backend = createPiBackend()
  const previous = process.env.OPENCODE_API_KEY
  const previousHomedir = os.homedir
  try {
    Reflect.deleteProperty(process.env, "OPENCODE_API_KEY")
    // Mock homedir to a non-existent directory so auth.json is not found
    os.homedir = () => "/nonexistent"
    const status = await backend.getAuthStatuses()
    assert.equal(status.available, false)
  } finally {
    os.homedir = previousHomedir
    if (previous !== undefined) process.env.OPENCODE_API_KEY = previous
  }
})

test("getAuthStatuses detects ~/.pi/agent/auth.json when present", async () => {
  const backend = createPiBackend()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auth-test-"))
  const authDir = path.join(tempDir, ".pi", "agent")
  const authFile = path.join(authDir, "auth.json")

  // Save original env var and homedir
  const previousApiKey = process.env.OPENCODE_API_KEY
  const previousHomedir = os.homedir

  try {
    // Unset API key and mock os.homedir()
    Reflect.deleteProperty(process.env, "OPENCODE_API_KEY")
    os.homedir = () => tempDir

    // Create auth file
    fs.mkdirSync(authDir, { recursive: true })
    fs.writeFileSync(authFile, "{}")

    const status = await backend.getAuthStatuses()
    assert.equal(status.available, true)
    assert.match(status.raw, /auth\.json present/)
  } finally {
    // Restore
    os.homedir = previousHomedir
    if (previousApiKey !== undefined) process.env.OPENCODE_API_KEY = previousApiKey
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test("cancel delegates to terminateProcessTree and handles a non-finite pid", async () => {
  const backend = createPiBackend()
  const result = await backend.cancel(Number.NaN)
  assert.equal(result.attempted, false)
})
