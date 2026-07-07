import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createOpencodeBackend } from "../scripts/lib/opencode-backend.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, "fixtures")

async function withFakeOpencodeOnPath(fn) {
  const originalPath = process.env.PATH
  process.env.PATH = `${fixturesDir}${path.delimiter}${originalPath}`
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
  }
}

test("listModels parses the fake opencode's model listing", async () => {
  await withFakeOpencodeOnPath(async () => {
    const backend = createOpencodeBackend()
    const models = await backend.listModels()
    assert.deepEqual(models, [
      { provider: "opencode-go", model: "deepseek-v4-pro" },
      { provider: "opencode", model: "big-pickle" },
      { provider: "anthropic", model: "claude" },
    ])
  })
})

test("listModels passes --refresh flag when refresh option is true", async () => {
  await withFakeOpencodeOnPath(async () => {
    const captureFile = path.join(__dirname, ".args-capture")
    const previous = process.env.OPENCODE_CAPTURE_ARGS_FILE
    process.env.OPENCODE_CAPTURE_ARGS_FILE = captureFile
    try {
      const backend = createOpencodeBackend()
      await backend.listModels(undefined, { refresh: true })
      const capturedArgs = JSON.parse(fs.readFileSync(captureFile, "utf8"))
      assert.deepEqual(capturedArgs, ["models", "--refresh"])
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "OPENCODE_CAPTURE_ARGS_FILE")
      else process.env.OPENCODE_CAPTURE_ARGS_FILE = previous
      if (fs.existsSync(captureFile)) fs.unlinkSync(captureFile)
    }
  })
})

test("sendPrompt captures the fake opencode's stdout as rawOutput", async () => {
  await withFakeOpencodeOnPath(async () => {
    const backend = createOpencodeBackend()
    const result = await backend.sendPrompt({
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      prompt: "test",
    })
    assert.equal(result.exitCode, 0)
    const parsed = JSON.parse(result.rawOutput)
    assert.equal(parsed.verdict, "approve")
  })
})

test("sendPrompt caps oversized stdout", async () => {
  await withFakeOpencodeOnPath(async () => {
    const backend = createOpencodeBackend()
    const previous = process.env.OPENCODE_FIXTURE_OUTPUT_SIZE
    process.env.OPENCODE_FIXTURE_OUTPUT_SIZE = "150000"
    try {
      const result = await backend.sendPrompt({
        provider: "opencode-go",
        model: "deepseek-v4-pro",
        prompt: "test",
      })
      assert.equal(result.exitCode, 0)
      assert.match(result.rawOutput, /truncated at 100000 chars/)
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "OPENCODE_FIXTURE_OUTPUT_SIZE")
      else process.env.OPENCODE_FIXTURE_OUTPUT_SIZE = previous
    }
  })
})

test("cancel delegates to terminateProcessTree and handles a non-finite pid", async () => {
  const backend = createOpencodeBackend()
  const result = await backend.cancel(Number.NaN)
  assert.equal(result.attempted, false)
})
