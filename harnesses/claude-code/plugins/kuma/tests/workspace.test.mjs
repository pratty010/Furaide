import assert from "node:assert/strict"
import os from "node:os"
import { test } from "node:test"
import { resolveWorkspaceRoot } from "../scripts/lib/workspace.mjs"

test("resolveWorkspaceRoot falls back to cwd outside a git repo", () => {
  const nonRepoDir = os.tmpdir()
  assert.equal(resolveWorkspaceRoot(nonRepoDir), nonRepoDir)
})

test("resolveWorkspaceRoot resolves the repo root inside this repo", () => {
  const root = resolveWorkspaceRoot(process.cwd())
  assert.ok(root.length > 0)
})
