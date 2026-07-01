import { spawn } from "node:child_process"
import { binaryAvailable, terminateProcessTree } from "./process.mjs"

function runOneShot(command, args, { onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    onSpawn?.(child.pid)
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ status: code, stdout, stderr }))
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

    async listModels(providerFilter) {
      const args = providerFilter ? ["models", providerFilter] : ["models"]
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
