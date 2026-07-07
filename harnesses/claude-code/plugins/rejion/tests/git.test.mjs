import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  collectDiffPatch,
  collectDiffShortstat,
  getWorkingTreeState,
  resolveReviewTarget,
} from "../scripts/lib/git.mjs"

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

function withRepo(fn) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "rejion-git-test-"))
  try {
    git(repoDir, ["init", "-b", "main"])
    git(repoDir, ["config", "user.email", "rejion@example.com"])
    git(repoDir, ["config", "user.name", "Rejion Tests"])
    fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 1\n", "utf8")
    git(repoDir, ["add", "demo.js"])
    git(repoDir, ["commit", "-m", "init"])
    return fn(repoDir)
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true })
  }
}

test("getWorkingTreeState returns staged/unstaged/untracked arrays", () => {
  withRepo((repoDir) => {
    fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 2\n", "utf8")
    fs.writeFileSync(path.join(repoDir, "notes.txt"), "new note\n", "utf8")

    const state = getWorkingTreeState(repoDir)
    assert.ok(Array.isArray(state.staged))
    assert.ok(Array.isArray(state.unstaged))
    assert.ok(Array.isArray(state.untracked))
    assert.equal(state.untracked.includes("notes.txt"), true)
    assert.equal(typeof state.isDirty, "boolean")
  })
})

test("resolveReviewTarget defaults to working-tree when repo is dirty", () => {
  withRepo((repoDir) => {
    fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 2\n", "utf8")
    const target = resolveReviewTarget(repoDir, {})
    assert.equal(target.mode, "working-tree")
  })
})

test("collectDiffShortstat returns a shortstat summary for the resolved target", () => {
  withRepo((repoDir) => {
    fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 2\n", "utf8")
    const target = resolveReviewTarget(repoDir, { scope: "working-tree" })
    const stat = collectDiffShortstat(repoDir, target)
    assert.equal(stat.mode, "working-tree")
    assert.equal(typeof stat.changedFileCount, "number")
  })
})

test("collectDiffPatch returns patch object with patch and truncated keys", () => {
  withRepo((repoDir) => {
    fs.writeFileSync(path.join(repoDir, "demo.js"), "export const value = 2\n", "utf8")
    const target = resolveReviewTarget(repoDir, { scope: "working-tree" })
    const result = collectDiffPatch(repoDir, target)
    assert.equal(typeof result.patch, "string")
    assert.equal(typeof result.truncated, "boolean")
    assert.ok(result.patch.includes("diff --git"))
  })
})

test("collectDiffPatch respects maxChars size cap", () => {
  withRepo((repoDir) => {
    fs.writeFileSync(
      path.join(repoDir, "demo.js"),
      `export const value = "${"x".repeat(200)}"\n`,
      "utf8"
    )
    const target = resolveReviewTarget(repoDir, { scope: "working-tree" })
    const result = collectDiffPatch(repoDir, target, { maxChars: 10 })
    assert.equal(typeof result.patch, "string")
    assert.equal(result.truncated, true)
  })
})

test("collectDiffPatch does not throw when the diff exceeds a tiny injected maxBuffer", () => {
  withRepo((repoDir) => {
    fs.writeFileSync(
      path.join(repoDir, "demo.js"),
      `export const value = "${"x".repeat(5000)}"\n`,
      "utf8"
    )
    const target = resolveReviewTarget(repoDir, { scope: "working-tree" })
    const result = collectDiffPatch(repoDir, target, { maxBuffer: 10 })
    assert.equal(typeof result.patch, "string")
    assert.equal(typeof result.truncated, "boolean")
    assert.ok(result.patch.includes("unable to collect"))
  })
})

test("collectDiffPatch skips untracked files larger than the cap with a diagnostic note", () => {
  withRepo((repoDir) => {
    const largeContent = "y".repeat(30 * 1024)
    fs.writeFileSync(path.join(repoDir, "big-untracked.txt"), largeContent, "utf8")
    const target = resolveReviewTarget(repoDir, { scope: "working-tree" })
    const result = collectDiffPatch(repoDir, target)
    assert.ok(result.patch.includes("big-untracked.txt"))
    assert.ok(result.patch.includes("skipped:"))
    assert.equal(result.patch.includes(largeContent), false)
  })
})
