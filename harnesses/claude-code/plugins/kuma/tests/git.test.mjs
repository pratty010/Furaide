import assert from "node:assert/strict"
import { test } from "node:test"
import {
  collectDiffShortstat,
  getWorkingTreeState,
  resolveReviewTarget,
} from "../scripts/lib/git.mjs"

test("getWorkingTreeState returns staged/unstaged/untracked arrays", () => {
  const state = getWorkingTreeState(process.cwd())
  assert.ok(Array.isArray(state.staged))
  assert.ok(Array.isArray(state.unstaged))
  assert.ok(Array.isArray(state.untracked))
  assert.equal(typeof state.isDirty, "boolean")
})

test("resolveReviewTarget defaults to auto scope", () => {
  const target = resolveReviewTarget(process.cwd(), {})
  assert.ok(target.mode === "working-tree" || target.mode === "branch")
})

test("collectDiffShortstat returns a shortstat summary for the resolved target", () => {
  const target = resolveReviewTarget(process.cwd(), { scope: "working-tree" })
  const stat = collectDiffShortstat(process.cwd(), target)
  assert.equal(stat.mode, "working-tree")
  assert.equal(typeof stat.changedFileCount, "number")
})
