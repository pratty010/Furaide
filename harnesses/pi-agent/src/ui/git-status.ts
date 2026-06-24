import { spawnSync } from "node:child_process";

export interface GitDirty {
  staged: number;
  modified: number;
  untracked: number;
}

/**
 * Parse `git status --porcelain=v1` for the given cwd.
 * Counts:
 *  - staged:    any non-space, non-? index column (XY where X !== ' ' && X !== '?')
 *  - modified:  any non-space worktree column for a tracked file (Y !== ' ' && XY !== '??')
 *  - untracked: '??' entries
 * Returns zeros on any failure (no git, not a repo, etc.).
 */
export function readGitDirty(cwd: string): GitDirty {
  const zero: GitDirty = { staged: 0, modified: 0, untracked: 0 };
  try {
    const res = spawnSync("git", ["status", "--porcelain=v1"], { cwd, encoding: "utf8", timeout: 500 });
    if (res.status !== 0 || typeof res.stdout !== "string") return zero;
    let staged = 0, modified = 0, untracked = 0;
    for (const raw of res.stdout.split("\n")) {
      if (raw.length < 2) continue;
      const xy = raw.slice(0, 2);
      if (xy === "??") { untracked++; continue; }
      const x = xy[0]!;
      const y = xy[1]!;
      if (x !== " " && x !== "?") staged++;
      if (y !== " " && y !== "?") modified++;
    }
    return { staged, modified, untracked };
  } catch {
    return zero;
  }
}

export function formatGitDirty(d: GitDirty): string {
  const parts: string[] = [];
  if (d.staged > 0)    parts.push(`+${d.staged}`);
  if (d.modified > 0)  parts.push(`~${d.modified}`);
  if (d.untracked > 0) parts.push(`!${d.untracked}`);
  return parts.length === 0 ? "" : ` [${parts.join(" ")}]`;
}
