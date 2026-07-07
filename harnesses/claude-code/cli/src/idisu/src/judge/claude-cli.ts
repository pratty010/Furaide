import { spawnSync as nodeSpawnSync } from "node:child_process";
import type { JudgeBackend } from "./interface.js";

// Phase 4 (Judge) — `claude -p` backend. See Task 4.2,
// docs/superpowers/plans/2026-07-06-idisu-v2.md.
//
// Shells out to the ambient `claude` CLI in headless mode and parses its
// stdout for one of the four `JudgeBackend` labels. This backend relies on
// whatever auth the environment's `claude` binary is already configured
// with (subscription login) — it does not read or set `ANTHROPIC_API_KEY`
// or any other credential.
//
// Fail-soft contract: nothing thrown here escapes `label()`. Any exec
// failure, non-zero exit, unparseable output, or unexpected exception
// resolves to `"unknown"` so a flaky/missing `claude` binary can never
// crash the dream loop.

const VALID_LABELS = ["success", "failure", "abandoned", "unknown"] as const;
type Label = (typeof VALID_LABELS)[number];

/**
 * Minimal shape `label()` needs from `child_process.spawnSync`, decoupled
 * from Node's overloaded generic signature so tests can inject a fake
 * without fighting the real type. The default (`nodeSpawnSyncAdapter`)
 * wraps the genuine `node:child_process` call.
 */
export interface SpawnSyncLike {
  (
    command: string,
    args: string[],
    options?: Record<string, unknown>,
  ): { stdout: string; status: number | null; error?: Error };
}

const nodeSpawnSyncAdapter: SpawnSyncLike = (command, args, options) => {
  const result = nodeSpawnSync(command, args, {
    ...options,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { stdout: result.stdout ?? "", status: result.status, error: result.error };
};

/**
 * Strict token parse: after trimming surrounding whitespace, lowercasing,
 * and stripping incidental markdown/punctuation the model may wrap the
 * token in (backticks, asterisks, quotes, trailing period), the ENTIRE
 * remaining string must equal exactly one of the four valid labels.
 * Anything else — extra prose, a sentence containing the word, multiple
 * lines, empty output — falls back to `"unknown"`. No substring matching.
 */
export function parseJudgeLabel(stdout: string | null | undefined): Label {
  if (!stdout) return "unknown";
  const normalized = stdout
    .trim()
    .toLowerCase()
    .replace(/^[`*_~"'.\s]+/, "")
    .replace(/[`*_~"'.\s]+$/, "");
  return (VALID_LABELS as readonly string[]).includes(normalized)
    ? (normalized as Label)
    : "unknown";
}

export class ClaudeCliJudgeBackend implements JudgeBackend {
  constructor(
    private readonly spawnSyncFn: SpawnSyncLike = nodeSpawnSyncAdapter,
  ) {}

  async label(prompt: string, model: string): Promise<Label> {
    try {
      const result = this.spawnSyncFn("claude", ["-p", prompt, "--model", model]);
      if (result.error) return "unknown";
      if (result.status !== 0) return "unknown";
      return parseJudgeLabel(result.stdout);
    } catch {
      // Fail-soft: never let a spawn/parse exception escape into the
      // dream loop.
      return "unknown";
    }
  }
}
