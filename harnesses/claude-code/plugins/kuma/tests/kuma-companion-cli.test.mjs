import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createJob, markRunning } from "../scripts/lib/job.mjs"
import { saveModelIndex } from "../scripts/lib/models.mjs"
import { listJobs } from "../scripts/lib/state.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const companionPath = path.join(__dirname, "..", "scripts", "kuma-companion.mjs")
const fixturesDir = path.join(__dirname, "fixtures")

function runCli(args, { cwd, env = {} } = {}) {
  return spawnSync("node", [companionPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))

  const cleanup = () => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  try {
    const result = fn(dir)
    if (result && typeof result.then === "function") {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

function withFakeBackendsOnPath(fn) {
  const previous = process.env.PATH
  process.env.PATH = `${fixturesDir}${path.delimiter}${previous}`
  try {
    const result = fn()
    if (result && typeof result.then === "function") {
      return result.finally(() => {
        process.env.PATH = previous
      })
    }
    process.env.PATH = previous
    return result
  } catch (error) {
    process.env.PATH = previous
    throw error
  }
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

function initGitRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-repo-"))
  git(repoDir, ["init", "-b", "main"])
  git(repoDir, ["config", "user.email", "kuma@example.com"])
  git(repoDir, ["config", "user.name", "Kuma Tests"])
  fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 1\n", "utf8")
  git(repoDir, ["add", "demo.js"])
  git(repoDir, ["commit", "-m", "init"])
  return repoDir
}

function seedModelIndex(workspaceDir, pluginDataDir) {
  return withPluginDataEnv(pluginDataDir, () => {
    saveModelIndex(workspaceDir, [
      { model: "deepseek-v4-pro", provider: "opencode-go", backend: "both", status: "available" },
      { model: "big-pickle", provider: "opencode", backend: "both", status: "available" },
      { model: "tiny", provider: "ollama-cloud", backend: "opencode", status: "available" },
    ])
  })
}

function withPluginDataEnv(pluginDataDir, fn) {
  const previous = process.env.KUMA_PLUGIN_DATA
  process.env.KUMA_PLUGIN_DATA = pluginDataDir
  try {
    const result = fn()
    if (result && typeof result.then === "function") {
      return result.finally(() => {
        if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
        else process.env.KUMA_PLUGIN_DATA = previous
      })
    }
    if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
    else process.env.KUMA_PLUGIN_DATA = previous
    return result
  } catch (error) {
    if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
    else process.env.KUMA_PLUGIN_DATA = previous
    throw error
  }
}

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli([])
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes("Usage:"))
})

test("models prints a hint when no index is cached", () => {
  withTempDir("kuma-cli-test-", (dir) => {
    const result = runCli(["models"], { env: { KUMA_PLUGIN_DATA: dir } })
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes("No model index cached yet"))
  })
})

test("status prints a message when no jobs are recorded", () => {
  withTempDir("kuma-cli-test-", (dir) => {
    const result = runCli(["status"], { env: { KUMA_PLUGIN_DATA: dir } })
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes("No jobs recorded"))
  })
})

test("task fails clearly when no backend/model default is configured", () => {
  withTempDir("kuma-cli-test-", (dir) => {
    const result = runCli(["task", "do something"], { env: { KUMA_PLUGIN_DATA: dir } })
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes("/kuma:setup"))
  })
})

test("review fails clearly when no backend/model default is configured", () => {
  withTempDir("kuma-cli-test-", (dir) => {
    const result = runCli(["review"], { env: { KUMA_PLUGIN_DATA: dir } })
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes("/kuma:setup"))
  })
})

test("review prompt includes working-tree diff code and untracked text", () => {
  withFakeBackendsOnPath(() =>
    withTempDir("kuma-plugin-data-", (pluginDataDir) => {
      const repoDir = initGitRepo()
      try {
        fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 2\n", "utf8")
        git(repoDir, ["add", "demo.js"])
        fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 3\n", "utf8")
        fs.writeFileSync(path.join(repoDir, "notes.txt"), "new note\n", "utf8")

        const promptFile = path.join(pluginDataDir, "prompt.txt")
        const result = runCli(
          [
            "review",
            "--backend",
            "opencode",
            "--model",
            "opencode-go/deepseek-v4-pro",
            "--scope",
            "working-tree",
          ],
          {
            cwd: repoDir,
            env: {
              KUMA_PLUGIN_DATA: pluginDataDir,
              PATH: `${fixturesDir}${path.delimiter}${process.env.PATH}`,
              OPENCODE_CAPTURE_PROMPT_FILE: promptFile,
            },
          }
        )

        assert.equal(result.status, 0, result.stderr)
        const prompt = fs.readFileSync(promptFile, "utf8")
        assert.ok(prompt.includes("Diff:"))
        assert.ok(prompt.includes("diff --git"))
        assert.ok(prompt.includes("export const value = 2"))
        assert.ok(prompt.includes("export const value = 3"))
        assert.ok(prompt.includes("=== untracked: notes.txt ==="))
        assert.ok(prompt.includes("new note"))
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true })
      }
    })
  )
})

test("review prompt includes branch diff code from merge-base..HEAD", () => {
  withFakeBackendsOnPath(() =>
    withTempDir("kuma-plugin-data-", (pluginDataDir) => {
      const repoDir = initGitRepo()
      try {
        fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 5\n", "utf8")
        git(repoDir, ["commit", "-am", "change"])

        const promptFile = path.join(pluginDataDir, "branch-prompt.txt")
        const result = runCli(
          [
            "review",
            "--backend",
            "opencode",
            "--model",
            "opencode-go/deepseek-v4-pro",
            "--base",
            "HEAD~1",
          ],
          {
            cwd: repoDir,
            env: {
              KUMA_PLUGIN_DATA: pluginDataDir,
              PATH: `${fixturesDir}${path.delimiter}${process.env.PATH}`,
              OPENCODE_CAPTURE_PROMPT_FILE: promptFile,
            },
          }
        )

        assert.equal(result.status, 0, result.stderr)
        const prompt = fs.readFileSync(promptFile, "utf8")
        assert.ok(prompt.includes("branch diff against HEAD~1"))
        assert.ok(prompt.includes("diff --git"))
        assert.ok(prompt.includes("export const value = 5"))
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true })
      }
    })
  )
})

test("review backend failure is stored as job error", () => {
  withFakeBackendsOnPath(() =>
    withTempDir("kuma-plugin-data-", (pluginDataDir) => {
      const repoDir = initGitRepo()
      try {
        fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 9\n", "utf8")
        const result = runCli(
          [
            "review",
            "--backend",
            "opencode",
            "--model",
            "opencode-go/deepseek-v4-pro",
            "--scope",
            "working-tree",
          ],
          {
            cwd: repoDir,
            env: {
              KUMA_PLUGIN_DATA: pluginDataDir,
              PATH: `${fixturesDir}${path.delimiter}${process.env.PATH}`,
              OPENCODE_FIXTURE_FAIL: "1",
            },
          }
        )

        assert.notEqual(result.status, 0)
        const [job] = withPluginDataEnv(pluginDataDir, () => listJobs(repoDir))
        assert.equal(job.status, "error")
        assert.match(job.errorMessage, /Backend exited with code 1/)
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true })
      }
    })
  )
})

test("task backend failure is stored as job error", () => {
  withFakeBackendsOnPath(() =>
    withTempDir("kuma-plugin-data-", (pluginDataDir) => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-workspace-"))
      try {
        seedModelIndex(workspaceDir, pluginDataDir)
        const result = runCli(
          ["task", "--backend", "pi", "--model", "deepseek-v4-pro", "do something"],
          {
            cwd: workspaceDir,
            env: {
              KUMA_PLUGIN_DATA: pluginDataDir,
              PATH: `${fixturesDir}${path.delimiter}${process.env.PATH}`,
              PI_FIXTURE_FAIL: "1",
            },
          }
        )

        assert.notEqual(result.status, 0)
        const [job] = withPluginDataEnv(pluginDataDir, () => listJobs(workspaceDir))
        assert.equal(job.status, "error")
        assert.match(job.errorMessage, /Backend exited with code 1/)
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true })
      }
    })
  )
})

test("explicit provider/model does not double-prefix provider", () => {
  withFakeBackendsOnPath(() =>
    withTempDir("kuma-plugin-data-", (pluginDataDir) => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-workspace-"))
      try {
        const argsFile = path.join(pluginDataDir, "args.json")
        const result = runCli(
          [
            "task",
            "--backend",
            "opencode",
            "--model",
            "opencode-go/deepseek-v4-pro",
            "do something",
          ],
          {
            cwd: workspaceDir,
            env: {
              KUMA_PLUGIN_DATA: pluginDataDir,
              PATH: `${fixturesDir}${path.delimiter}${process.env.PATH}`,
              OPENCODE_CAPTURE_ARGS_FILE: argsFile,
            },
          }
        )

        assert.equal(result.status, 0, result.stderr)
        const args = JSON.parse(fs.readFileSync(argsFile, "utf8"))
        const modelIndex = args.indexOf("-m")
        assert.equal(args[modelIndex + 1], "opencode-go/deepseek-v4-pro")
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true })
      }
    })
  )
})

test("bare model resolves provider from cached index", () => {
  withFakeBackendsOnPath(() =>
    withTempDir("kuma-plugin-data-", (pluginDataDir) => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-workspace-"))
      try {
        seedModelIndex(workspaceDir, pluginDataDir)
        const argsFile = path.join(pluginDataDir, "args.json")
        const result = runCli(
          ["task", "--backend", "opencode", "--model", "deepseek-v4-pro", "do something"],
          {
            cwd: workspaceDir,
            env: {
              KUMA_PLUGIN_DATA: pluginDataDir,
              PATH: `${fixturesDir}${path.delimiter}${process.env.PATH}`,
              OPENCODE_CAPTURE_ARGS_FILE: argsFile,
            },
          }
        )

        assert.equal(result.status, 0, result.stderr)
        const args = JSON.parse(fs.readFileSync(argsFile, "utf8"))
        const modelIndex = args.indexOf("-m")
        assert.equal(args[modelIndex + 1], "opencode-go/deepseek-v4-pro")
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true })
      }
    })
  )
})

test("active review blocks task even with --fresh", () => {
  withTempDir("kuma-plugin-data-", (pluginDataDir) => {
    const previous = process.env.KUMA_PLUGIN_DATA
    process.env.KUMA_PLUGIN_DATA = pluginDataDir
    try {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-workspace-"))
      try {
        createJob(workspaceDir, {
          kind: "review",
          provider: "opencode-go",
          model: "deepseek-v4-pro",
          backend: "opencode",
        })
        const result = runCli(
          [
            "task",
            "--backend",
            "opencode",
            "--model",
            "opencode-go/deepseek-v4-pro",
            "--fresh",
            "do something",
          ],
          { cwd: workspaceDir, env: { KUMA_PLUGIN_DATA: pluginDataDir } }
        )
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /already active/)
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true })
      }
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
      else process.env.KUMA_PLUGIN_DATA = previous
    }
  })
})

test("active task blocks review", () => {
  withTempDir("kuma-plugin-data-", (pluginDataDir) => {
    const previous = process.env.KUMA_PLUGIN_DATA
    process.env.KUMA_PLUGIN_DATA = pluginDataDir
    try {
      const repoDir = initGitRepo()
      try {
        const job = createJob(repoDir, {
          kind: "task",
          provider: "opencode-go",
          model: "deepseek-v4-pro",
          backend: "opencode",
        })
        markRunning(repoDir, job.id, { pid: 123 })
        fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 7\n", "utf8")
        const result = runCli(
          [
            "review",
            "--backend",
            "opencode",
            "--model",
            "opencode-go/deepseek-v4-pro",
            "--scope",
            "working-tree",
          ],
          { cwd: repoDir, env: { KUMA_PLUGIN_DATA: pluginDataDir } }
        )
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /already active/)
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true })
      }
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
      else process.env.KUMA_PLUGIN_DATA = previous
    }
  })
})

test("backend/provider incompatibility fails before job creation", () => {
  withTempDir("kuma-plugin-data-", (pluginDataDir) => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-workspace-"))
    try {
      const result = runCli(
        ["task", "--backend", "pi", "--model", "ollama-cloud/tiny", "do something"],
        { cwd: workspaceDir, env: { KUMA_PLUGIN_DATA: pluginDataDir } }
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /cannot reach ollama-cloud/)
      assert.equal(withPluginDataEnv(pluginDataDir, () => listJobs(workspaceDir)).length, 0)
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})

test("cancel does not mark cancelled when pid is not available yet", () => {
  withTempDir("kuma-plugin-data-", (pluginDataDir) => {
    const previous = process.env.KUMA_PLUGIN_DATA
    process.env.KUMA_PLUGIN_DATA = pluginDataDir
    try {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-workspace-"))
      try {
        const job = createJob(workspaceDir, {
          kind: "task",
          provider: "opencode-go",
          model: "deepseek-v4-pro",
          backend: "opencode",
        })
        markRunning(workspaceDir, job.id, { pid: null })
        const result = runCli(["cancel", job.id], {
          cwd: workspaceDir,
          env: { KUMA_PLUGIN_DATA: pluginDataDir },
        })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /no backend pid yet/)
        assert.equal(
          withPluginDataEnv(pluginDataDir, () => listJobs(workspaceDir))[0].status,
          "running"
        )
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true })
      }
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "KUMA_PLUGIN_DATA")
      else process.env.KUMA_PLUGIN_DATA = previous
    }
  })
})
