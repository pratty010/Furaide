import { z } from 'zod'
import { readFileSync, existsSync } from 'node:fs'
import { CONFIG_FILE } from './paths.js'

export const ConfigSchema = z.object({
  version:                  z.literal(1).default(1),
  dream_interval_hours:     z.number().positive().default(24),
  harnesses:                z.array(z.enum(['claude_code', 'codex', 'opencode'])).default(['claude_code']),
  lookback_days:            z.number().positive().default(30),
  llm_budget_per_dream:     z.number().int().nonnegative().default(50_000),
  judge_backend:            z.enum(['claude_cli', 'none']).default('claude_cli'),
  judge_model:              z.string().default('claude-haiku-4-5'),
  evidence_retention_days:  z.number().positive().default(90),
  min_sample_threshold:     z.number().int().positive().default(5),
  cc_transcripts_dir:       z.string().default('~/.claude/projects'),
  codex_sessions_dir:       z.string().default('~/.codex/sessions'),
  opencode_db:              z.string().default('~/.local/share/opencode/opencode.db'),
  // Phase 5 (Mine, Task 5.2) — candidate-generation thresholds. A mined
  // `workflow_ngrams` row becomes a skill candidate only once it clears all
  // three: seen at least `min_repetition` times total, contributed by at
  // least `min_candidate_sessions` distinct sessions, and with at least
  // `min_candidate_successes` of those sessions labeled 'success'. Defaults
  // match the task's own literal test fixture (frequency>=3, >=2 sessions,
  // >=1 success).
  min_repetition:            z.number().int().positive().default(3),
  min_candidate_sessions:    z.number().int().positive().default(2),
  min_candidate_successes:   z.number().int().nonnegative().default(1),
  // FTS5 `bm25()` score below which a candidate is considered an overlapping
  // near-duplicate of an existing `artifacts` row and gets suppressed
  // (excluded from `generateCandidates`'s output entirely). Lower bm25 means
  // a closer match, so this is a maximum-distance cutoff, not a minimum —
  // see `mine/mine.ts#checkArtifactOverlap` for the full rationale. This is
  // an untuned starting default: `artifacts`/`artifacts_fts` are empty until
  // Phase 6 imports preexisting skills, so there is no real corpus yet to
  // calibrate against.
  candidate_overlap_bm25_max: z.number().nonnegative().default(2.0),
  // Phase 6 (Curate, Task 6.4) — staleness signal. An artifact with zero
  // distinct-session `capability.invoked` hits in the `events` table is
  // surfaced as a stale-flag proposal in the review queue. The
  // `stale_after_sessions` value documents the planned "N sessions without
  // a hit" intent from the v0.1 spec; today's honest implementation
  // (curate/curate.ts) treats the bar as simply "no hits at all" because
  // no global session counter that advances on each dream pass exists yet
  // (no place in the codebase writes one). This number is the threshold
  // we'll switch to once a real session counter lands. Untuned starting
  // default matches the spec literal.
  stale_after_sessions: z.number().int().positive().default(30),
  // Phase 6 (Curate, Task 6.4) — pairwise overlap threshold above which two
  // active artifacts are surfaced as a merge proposal in the review queue.
  // Implemented as a Jaccard token-overlap proxy on `surface_path` content
  // (see curate/curate.ts#jaccardOverlap's doc comment for why BM25 isn't
  // viable here yet: `artifacts_fts` is empty because nothing populates
  // its `text` column, and FTS5 ranking on an empty corpus returns nothing
  // useful). Untuned starting default — 0.6 is a typical "strong overlap"
  // threshold in set-similarity literature; will be calibrated once
  // `artifacts_fts` is populated.
  merge_overlap_threshold: z.number().min(0).max(1).default(0.6),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(overridePath?: string): Config {
  const path = overridePath ?? CONFIG_FILE
  if (!existsSync(path)) return ConfigSchema.parse({})
  return ConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
