import { spawn } from "node:child_process"
import { parseJsonLines } from "./events.mjs"
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

function parseListModelsOutput(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.trim().match(/^(\S+)\s+(\S+)/)
      if (!match) return null
      return { provider: match[1], model: match[2] }
    })
    .filter(Boolean)
}

export function createPiBackend() {
  return {
    name: "pi",

    async listModels(searchFilter) {
      const args = ["--list-models"]
      if (searchFilter) args.push(searchFilter)
      const { status, stdout, stderr } = await runOneShot("pi", args)
      if (status !== 0) {
        throw new Error(`pi --list-models failed: ${stderr || stdout}`)
      }
      return parseListModelsOutput(stdout)
    },

    async sendPrompt({ provider, model, prompt, sessionHandle, onSpawn }) {
      const args = ["-p", "--mode", "json", "--model", `${provider}/${model}`]
      if (sessionHandle) {
        args.push("--session", sessionHandle)
      }
      args.push(prompt)
      const { status, stdout, stderr } = await runOneShot("pi", args, { onSpawn })
      const events = parseJsonLines(stdout)
      return { exitCode: status, rawOutput: stdout, events, stderr }
    },

    async getAuthStatuses() {
      const opencodeKeyPresent = Boolean(process.env.OPENCODE_API_KEY)
      return {
        available: opencodeKeyPresent,
        raw: opencodeKeyPresent ? "OPENCODE_API_KEY set" : "OPENCODE_API_KEY missing",
      }
    },

    async isAvailable() {
      return binaryAvailable("pi")
    },

    async cancel(pid) {
      return terminateProcessTree(pid)
    },
  }
}
