import type { Database } from "bun:sqlite";
import { upsertOutcomeLabel } from "../store/repo.js";
import type { EventEnvelope, EventType, Harness } from "../types/events.js";
import type { JudgeBackend, SegmentLabel } from "./interface.js";
import { tier1Label } from "./tier1.js";

// Phase 4 (Judge) — Task 4.3: two-tier, budgeted orchestrator. See
// docs/superpowers/plans/2026-07-06-idisu-v2.md Task 4.3.
//
// Rough constant-cost-per-call token estimate (prompt + response). This is
// NOT a real tokenizer — per YAGNI, a flat estimate is good enough to gate
// "can we afford one more call" against `llm_budget_per_dream`. Revisit only
// if real `claude -p` usage numbers show this is meaningfully off.
export const ESTIMATED_TOKENS_PER_JUDGE_CALL = 500;

// Row shape as it comes back from `SELECT * FROM events` — same duplication
// rationale as store/repo.ts's own `EventTableRow`/`rowToEnvelope` (kept
// local to each phase rather than shared, so Judge doesn't couple to
// Consolidate/Store internals across phase boundaries).
interface EventTableRow {
  event_id: string;
  schema_version: number;
  source_id: string;
  source_position: number | string;
  observed_at: string;
  ingested_at: string;
  harness: string;
  event_type: string;
  payload_version: number;
  payload: string;
}

function rowToEnvelope(row: EventTableRow): EventEnvelope {
  return {
    schema_version: row.schema_version as 1,
    event_id: row.event_id,
    source_id: row.source_id,
    source_position: row.source_position,
    observed_at: row.observed_at,
    ingested_at: row.ingested_at,
    harness: row.harness as Harness,
    event_type: row.event_type as EventType,
    payload_version: row.payload_version,
    payload: JSON.parse(row.payload),
  };
}

function loadAllEvents(db: Database): EventEnvelope[] {
  const rows = db
    .query("SELECT * FROM events ORDER BY observed_at ASC")
    .all() as EventTableRow[];
  return rows.map(rowToEnvelope);
}

/** Groups events by `payload.session_id` — same grouping key rationale as
 * `store/repo.ts#getEventsForSession` and `dream/consolidate.ts#rollupSessions`
 * (a session can appear under >1 `source_id`, but only one logical
 * `session_id`). Events with no `session_id` in their payload are dropped;
 * they can't be attributed to any segment. */
function groupBySessionId(events: EventEnvelope[]): Map<string, EventEnvelope[]> {
  const bySession = new Map<string, EventEnvelope[]>();
  for (const e of events) {
    const sessionId = (e.payload as { session_id?: string } | null)?.session_id;
    if (!sessionId) continue;
    const list = bySession.get(sessionId);
    if (list) list.push(e);
    else bySession.set(sessionId, [e]);
  }
  return bySession;
}

// Value proxy for "collect unknown; sort by value (longest/most-repeated
// first)" (plan Task 4.3 Step 2): nothing in the schema today tracks a
// repetition count per segment — that's Phase 5 (Mine, n-gram/workflow
// mining) territory, not yet built. The best available stand-in at this
// phase is session duration: the span between the earliest and latest
// `observed_at` timestamp among a session's events. A longer session is a
// reasonable (if imperfect) proxy for "more happened here, more worth
// spending judge budget on" until a real repetition signal exists.
// Documented here as a stand-in, not a considered design choice.
function sessionDurationMs(events: EventEnvelope[]): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    const t = new Date(e.observed_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return max - min;
}

function updateSessionOutcomeLabel(db: Database, sessionId: string, label: string): void {
  db.query("UPDATE sessions SET outcome_label=? WHERE session_id=?").run(label, sessionId);
}

/** Minimal, self-contained judge prompt. Prompt engineering/evidence
 * curation is out of scope for this task — Task 4.2 already defined the
 * backend's strict single-token output contract (`parseJudgeLabel`); this
 * just needs to hand it *something* identifying the segment to reason
 * about. Revisit if judge accuracy in practice demands richer context. */
function buildJudgePrompt(label: SegmentLabel): string {
  return (
    `Classify the outcome of session "${label.session_id}", segment ` +
    `"${label.segment_key}" as exactly one of: success, failure, abandoned, ` +
    `unknown. Respond with only that single word.`
  );
}

export interface OrchestratorOptions {
  /** Pass `null` when the LLM backend is unavailable/not configured — the
   * orchestrator still runs Tier-1 and persists its results, but skips the
   * LLM tier entirely. */
  backend: JudgeBackend | null;
  model: string;
  /** Token budget for this dream pass, e.g. `config.llm_budget_per_dream`. */
  budgetTokens: number;
  /** Override for `ESTIMATED_TOKENS_PER_JUDGE_CALL`, mainly for tests. */
  tokensPerCall?: number;
}

export interface OrchestratorResult {
  segmentsLabeled: number;
  llmCallsMade: number;
}

/**
 * Two-tier judge orchestrator (Task 4.3).
 *
 * 1. Runs Tier-1 (deterministic) labeling over every session found in
 *    `events`, persisting every resulting `SegmentLabel` — including
 *    `unknown` ones — to `outcome_labels` via `upsertOutcomeLabel`, and
 *    updating `sessions.outcome_label` for session-level (`segment_key ===
 *    'session'`) labels.
 * 2. Collects the `unknown` segments, sorts them by the duration proxy
 *    above (longest session first), and calls the LLM backend for as many
 *    as `budgetTokens` allows (gated by `ESTIMATED_TOKENS_PER_JUDGE_CALL`
 *    per call), persisting each result with `tier: 'llm'` and `judge_model`
 *    set — this upserts over the same `(session_id, segment_key)` key, so
 *    it overwrites the Tier-1 `unknown` row in place.
 *
 * Skips the LLM tier entirely (Tier-1 results still persist) when
 * `opts.backend` is `null` or the budget can't afford even one call.
 */
export async function runJudgeOrchestrator(
  db: Database,
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const tokensPerCall = opts.tokensPerCall ?? ESTIMATED_TOKENS_PER_JUDGE_CALL;
  const bySession = groupBySessionId(loadAllEvents(db));

  let segmentsLabeled = 0;
  const unknowns: Array<{ label: SegmentLabel; value: number }> = [];

  for (const [sessionId, sessionEvents] of bySession) {
    const labels = tier1Label(sessionEvents, sessionId);
    const value = sessionDurationMs(sessionEvents);
    for (const label of labels) {
      upsertOutcomeLabel(db, label);
      segmentsLabeled++;
      if (label.segment_key === "session") {
        updateSessionOutcomeLabel(db, sessionId, label.label);
      }
      if (label.label === "unknown") {
        unknowns.push({ label, value });
      }
    }
  }

  let llmCallsMade = 0;
  if (opts.backend) {
    // Longest session first (see `sessionDurationMs` doc comment above).
    unknowns.sort((a, b) => b.value - a.value);

    let remaining = opts.budgetTokens;
    for (const { label } of unknowns) {
      if (remaining < tokensPerCall) break;
      const verdict = await opts.backend.label(buildJudgePrompt(label), opts.model);
      remaining -= tokensPerCall;
      llmCallsMade++;

      const llmLabel: SegmentLabel = {
        session_id: label.session_id,
        segment_key: label.segment_key,
        label: verdict,
        tier: "llm",
        judge_model: opts.model,
      };
      upsertOutcomeLabel(db, llmLabel);
      if (llmLabel.segment_key === "session") {
        updateSessionOutcomeLabel(db, llmLabel.session_id, llmLabel.label);
      }
    }
  }

  return { segmentsLabeled, llmCallsMade };
}
