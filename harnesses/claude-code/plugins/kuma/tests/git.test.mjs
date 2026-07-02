import assert from "node:assert/strict"
import { test } from "node:test"
import {
  collectDiffPatch,
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

test("collectDiffPatch returns patch object with patch and truncated keys", () => {
  const target = resolveReviewTarget(process.cwd(), { scope: "working-tree" })
  const result = collectDiffPatch(process.cwd(), target)
  assert.equal(typeof result.patch, "string")
  assert.equal(typeof result.truncated, "boolean")
})

test("collectDiffPatch respects maxChars size cap", () => {
  const target = resolveReviewTarget(process.cwd(), { scope: "working-tree" })
  const result = collectDiffPatch(process.cwd(), target, { maxChars: 10 })
  assert.equal(typeof result.patch, "string")
  if (result.patch.length > 0) {
    // If there is a patch, verify truncation logic either truncated it or didn't need to
    assert.ok(result.patch.length <= 10 + 100) // Allow some slack for truncation message
  }
})
