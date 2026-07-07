import fs from "node:fs"
import { isProbablyText } from "./fs.mjs"
import { runCommand, runCommandChecked } from "./process.mjs"

const DEFAULT_DIFF_MAX_BUFFER = 20 * 1024 * 1024
const MAX_UNTRACKED_FILE_BYTES = 24 * 1024

function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options })
}

function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", args, { cwd, ...options })
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"])
  const errorCode = result.error && "code" in result.error ? result.error.code : null
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.")
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.")
  }
  return result.stdout.trim()
}

export function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim()
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"])
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim()
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/origin/", "")
    }
  }

  const candidates = ["main", "master", "trunk"]
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`])
    if (local.status === 0) {
      return candidate
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`])
    if (remote.status === 0) {
      return `origin/${candidate}`
    }
  }

  throw new Error(
    "Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree."
  )
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD"
}

export function getWorkingTreeState(cwd) {
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
  const unstaged = gitChecked(cwd, ["diff", "--name-only"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean)

  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  }
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd)

  const requestedScope = options.scope ?? "auto"
  const baseRef = options.base ?? null
  const state = getWorkingTreeState(cwd)
  const supportedScopes = new Set(["auto", "working-tree", "branch"])

  if (baseRef) {
    return {
      mode: "branch",
      label: `branch diff against ${baseRef}`,
      baseRef,
      explicit: true,
    }
  }

  if (requestedScope === "working-tree") {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true,
    }
  }

  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    )
  }

  if (requestedScope === "branch") {
    const detectedBase = detectDefaultBranch(cwd)
    return {
      mode: "branch",
      label: `branch diff against ${detectedBase}`,
      baseRef: detectedBase,
      explicit: true,
    }
  }

  if (state.isDirty) {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false,
    }
  }

  const detectedBase = detectDefaultBranch(cwd)
  return {
    mode: "branch",
    label: `branch diff against ${detectedBase}`,
    baseRef: detectedBase,
    explicit: false,
  }
}

export function collectDiffShortstat(cwd, target) {
  const repoRoot = getRepoRoot(cwd)
  if (target.mode === "working-tree") {
    const staged = gitChecked(repoRoot, ["diff", "--shortstat", "--cached"]).stdout.trim()
    const unstaged = gitChecked(repoRoot, ["diff", "--shortstat"]).stdout.trim()
    const state = getWorkingTreeState(repoRoot)
    return {
      mode: "working-tree",
      stagedShortstat: staged,
      unstagedShortstat: unstaged,
      changedFileCount: new Set([...state.staged, ...state.unstaged, ...state.untracked]).size,
      untrackedCount: state.untracked.length,
    }
  }
  const mergeBase = gitChecked(repoRoot, ["merge-base", "HEAD", target.baseRef]).stdout.trim()
  const commitRange = `${mergeBase}..HEAD`
  const shortstat = gitChecked(repoRoot, ["diff", "--shortstat", commitRange]).stdout.trim()
  const changedFileCount = gitChecked(repoRoot, ["diff", "--name-only", commitRange])
    .stdout.trim()
    .split("\n")
    .filter(Boolean).length
  return { mode: "branch", baseRef: target.baseRef, shortstat, changedFileCount, untrackedCount: 0 }
}

const DIFF_SAFETY_FLAGS = ["--binary", "--no-ext-diff", "--submodule=diff"]

export function collectDiffPatch(cwd, target, options = {}) {
  const repoRoot = getRepoRoot(cwd)
  const maxChars = options.maxChars ?? 20000
  const maxBuffer = options.maxBuffer ?? DEFAULT_DIFF_MAX_BUFFER
  let patch = ""

  if (target.mode === "working-tree") {
    // Collect staged changes
    try {
      const stagedResult = gitChecked(repoRoot, ["diff", "--cached", ...DIFF_SAFETY_FLAGS], {
        maxBuffer,
      })
      const stagedPatch = stagedResult.stdout
      if (stagedPatch.trim()) {
        patch += "=== staged changes ===\n"
        patch += stagedPatch
      }
    } catch (error) {
      if (patch) patch += "\n"
      patch += `=== staged changes ===\n[unable to collect staged diff: ${error.message}]\n`
    }

    // Collect unstaged changes
    try {
      const unstagedResult = gitChecked(repoRoot, ["diff", ...DIFF_SAFETY_FLAGS], { maxBuffer })
      const unstagedPatch = unstagedResult.stdout
      if (unstagedPatch.trim()) {
        if (patch) patch += "\n"
        patch += "=== unstaged changes ===\n"
        patch += unstagedPatch
      }
    } catch (error) {
      if (patch) patch += "\n"
      patch += `=== unstaged changes ===\n[unable to collect unstaged diff: ${error.message}]\n`
    }

    // Collect untracked files
    const state = getWorkingTreeState(repoRoot)
    for (const filePath of state.untracked) {
      const absolutePath = `${repoRoot}/${filePath}`
      let stat
      try {
        stat = fs.statSync(absolutePath)
      } catch {
        if (patch) patch += "\n"
        patch += `=== untracked: ${filePath} (skipped: unreadable) ===\n`
        continue
      }
      if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
        if (patch) patch += "\n"
        patch += `=== untracked: ${filePath} (skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_FILE_BYTES}-byte cap) ===\n`
        continue
      }
      try {
        const content = fs.readFileSync(absolutePath)
        if (isProbablyText(content)) {
          if (patch) patch += "\n"
          patch += `=== untracked: ${filePath} ===\n`
          patch += content.toString("utf8")
        }
      } catch {
        if (patch) patch += "\n"
        patch += `=== untracked: ${filePath} (skipped: unreadable) ===\n`
      }
    }
  } else {
    // Branch mode
    const mergeBase = gitChecked(repoRoot, ["merge-base", "HEAD", target.baseRef]).stdout.trim()
    const commitRange = `${mergeBase}..HEAD`
    try {
      const diffResult = gitChecked(repoRoot, ["diff", commitRange, ...DIFF_SAFETY_FLAGS], {
        maxBuffer,
      })
      patch = diffResult.stdout
    } catch (error) {
      patch = `=== branch diff ===\n[unable to collect branch diff: ${error.message}]\n`
    }
  }

  // Apply size cap
  let truncated = false
  if (patch.length > maxChars) {
    const totalChars = patch.length
    patch = patch.slice(0, maxChars)
    patch += `\n\n[... diff truncated at ${maxChars} characters; ${totalChars} total ...]`
    truncated = true
  }

  return { patch, truncated }
}
