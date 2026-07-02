import { spawn } from "node:child_process"
import { binaryAvailable, terminateProcessTree } from "./process.mjs"

const MAX_OUTPUT_CHARS = 100000

function createOutputCollector() {
  let text = ""
  let truncated = false

  return {
    push(chunk) {
      const nextChunk = String(chunk)
      if (truncated || nextChunk.length === 0) return

      const remaining = MAX_OUTPUT_CHARS - text.length
      if (remaining <= 0) {
        truncated = true
        return
      }

      if (nextChunk.length <= remaining) {
        text += nextChunk
        return
      }

      text += nextChunk.slice(0, remaining)
      truncated = true
    },

    finish(label) {
      return truncated
        ? `${text}\n\n[... ${label} truncated at ${MAX_OUTPUT_CHARS} chars ...]`
        : text
    },
  }
}

function runOneShot(command, args, { onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] })
    onSpawn?.(child.pid)
    const stdout = createOutputCollector()
    const stderr = createOutputCollector()
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk)
    })
    child.on("error", reject)
    child.on("close", (code, signal) =>
      resolve({
        status: code ?? (signal ? 1 : 0),
        signal: signal ?? null,
        stdout: stdout.finish("stdout"),
        stderr: stderr.finish("stderr"),
      })
    )
  })
}

function parseModelsListing(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const slashIndex = line.indexOf("/")
      if (slashIndex === -1) return null
      return {
        provider: line.slice(0, slashIndex).trim(),
        model: line.slice(slashIndex + 1).trim(),
      }
    })
    .filter(Boolean)
}

export function createOpencodeBackend() {
  return {
    name: "opencode",

    async listModels(providerFilter, { refresh = false } = {}) {
      const args = providerFilter ? ["models", providerFilter] : ["models"]
      if (refresh) args.push("--refresh")
      const { status, stdout, stderr } = await runOneShot("opencode", args)
      if (status !== 0) {
        throw new Error(`opencode models failed: ${stderr || stdout}`)
      }
      return parseModelsListing(stdout)
    },

    async sendPrompt({ provider, model, prompt, sessionHandle, onSpawn }) {
      const args = ["run", "-m", `${provider}/${model}`, "--format", "json"]
      if (sessionHandle) {
        args.push("--session", sessionHandle)
      }
      args.push(prompt)
      const { status, stdout, stderr } = await runOneShot("opencode", args, { onSpawn })
      return { exitCode: status, rawOutput: stdout, stderr }
    },

    async getAuthStatuses() {
      const { status, stdout } = await runOneShot("opencode", ["providers", "list"])
      return { available: status === 0, raw: stdout }
    },

    async isAvailable() {
      return binaryAvailable("opencode")
    },

    async cancel(pid) {
      return terminateProcessTree(pid)
    },
  }
}
