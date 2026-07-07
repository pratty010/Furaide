import type { Database } from "bun:sqlite";
import { getEventsForSession } from "../store/repo.js";
import type {
  EventEnvelope,
  OutcomeObservedPayload,
  SessionObservedPayload,
} from "../types/events.js";
import type { SegmentLabel } from "./interface.js";

// Tier-1 (deterministic) labeling.
//
// Rules are checked in this EXACT priority order (highest first) — see
// docs/superpowers/plans/2026-07-06-idisu-v2.md Task 4.1 Step 3:
//   1. pr-link merged                              -> success
//   2. any build/test tool_result nonzero exit      -> failure
//   3. task record `completed` / `abandoned`        -> success / abandoned
//   4. clean Stop                                   -> success
//   else                                            -> unknown
//
// Rule 3 gap: no producer in this codebase (adapters/*, store/event-log.ts,
// dream/consolidate.ts) emits an explicit task-completion or task-abandonment
// record today — grepped for Stop/completed/abandoned and found nothing but
// the `outcome_labels` table's own CHECK constraint. Rather than fabricate a
// fake event type to satisfy the rule, it is implemented as a documented
// no-op (see `RULE_TASK_RECORD` below): it never matches until a real
// producer exists, and falls through to the next rule.
//
// Rule 4 proxy: `SessionObservedPayload.ended_cleanly` already exists in the
// schema (types/events.ts) but, per dream/consolidate.ts's rollupSessions doc
// comment (same gap noted there for `model`/`cwd`), no adapter populates it
// yet. This rule fires ONLY when a `session.observed` event explicitly
// carries `ended_cleanly: true` — it does not infer a clean stop merely from
// the absence of a failure signal, since that would silently swallow the
// "no signal -> unknown" fallback case.

const SESSION_SEGMENT = "session";

function isPrLinkSuccess(e: EventEnvelope): boolean {
  if (e.event_type !== "outcome.observed") return false;
  const p = e.payload as OutcomeObservedPayload & { kind?: string };
  return p.kind === "pr-link" && p.status === "success";
}

function isNonPrLinkFailure(e: EventEnvelope): boolean {
  if (e.event_type !== "outcome.observed") return false;
  const p = e.payload as OutcomeObservedPayload & { kind?: string };
  return p.kind !== "pr-link" && p.status === "failure";
}

// Rule 3: task record completed/abandoned. Documented no-op — see file
// header. Kept as an explicit (always-false) step in the chain so the
// priority order stays legible and the gap is visible at the call site,
// rather than silently skipped.
function taskRecordLabel(
  _events: EventEnvelope[],
): "success" | "abandoned" | null {
  return null;
}

function labelSession(
  sessionId: string,
  events: EventEnvelope[],
): SegmentLabel {
  // Rule 1: pr-link merged -> success
  const prLink = events.find(isPrLinkSuccess);
  if (prLink)
    return {
      session_id: sessionId,
      segment_key: SESSION_SEGMENT,
      label: "success",
      tier: "deterministic",
      evidence_ref: prLink.event_id,
    };

  // Rule 2: any build/test tool_result nonzero exit -> failure
  const failure = events.find(isNonPrLinkFailure);
  if (failure)
    return {
      session_id: sessionId,
      segment_key: SESSION_SEGMENT,
      label: "failure",
      tier: "deterministic",
      evidence_ref: failure.event_id,
    };

  // Rule 3: task record completed/abandoned (documented no-op — see header)
  const taskLabel = taskRecordLabel(events);
  if (taskLabel)
    return {
      session_id: sessionId,
      segment_key: SESSION_SEGMENT,
      label: taskLabel,
      tier: "deterministic",
    };

  // Rule 4: clean Stop proxy -> success (only on explicit ended_cleanly:true)
  const sessionObserved = events.find(
    (e) => e.event_type === "session.observed",
  );
  if (sessionObserved) {
    const p = sessionObserved.payload as SessionObservedPayload;
    if (p.ended_cleanly === true) {
      return {
        session_id: sessionId,
        segment_key: SESSION_SEGMENT,
        label: "success",
        tier: "deterministic",
        evidence_ref: sessionObserved.event_id,
      };
    }
  }

  return {
    session_id: sessionId,
    segment_key: SESSION_SEGMENT,
    label: "unknown",
    tier: "deterministic",
  };
}

/**
 * Per-workflow-segment granularity, kept intentionally minimal for this task:
 * Phase 5 (Mine, not yet built) is what defines real workflow segments via
 * n-gram signatures over tool-call/turn boundaries. Until then, the only
 * finer-than-session segment cheaply derivable from what Phase 2 already
 * emits is "the turn a failing tool call happened in" — joined via
 * `tool.called`'s (tool_use_id -> turn_index) against a failing
 * `outcome.observed`'s tool_use_id. Segments are only emitted where a
 * concrete failure is attributable; there is no positive/success signal at
 * turn granularity today, so this does not attempt to label every turn.
 */
function labelTurnSegments(
  sessionId: string,
  events: EventEnvelope[],
): SegmentLabel[] {
  const turnByToolUseId = new Map<string, number>();
  for (const e of events) {
    if (e.event_type !== "tool.called") continue;
    const p = e.payload as { tool_use_id: string; turn_index: number };
    turnByToolUseId.set(p.tool_use_id, p.turn_index);
  }

  const labels: SegmentLabel[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!isNonPrLinkFailure(e)) continue;
    const p = e.payload as OutcomeObservedPayload;
    const turnIndex = turnByToolUseId.get(p.tool_use_id);
    if (turnIndex === undefined) continue;
    const segmentKey = `turn:${turnIndex}`;
    if (seen.has(segmentKey)) continue;
    seen.add(segmentKey);
    labels.push({
      session_id: sessionId,
      segment_key: segmentKey,
      label: "failure",
      tier: "deterministic",
      evidence_ref: e.event_id,
    });
  }
  return labels;
}

/** Pure tier-1 labeling over an already-loaded event set. */
export function tier1Label(
  events: EventEnvelope[],
  sessionId: string,
): SegmentLabel[] {
  return [
    labelSession(sessionId, events),
    ...labelTurnSegments(sessionId, events),
  ];
}

/** Convenience wrapper: loads a session's events from `idisu.db` via the
 * Phase 1 store primitives, then delegates to the pure `tier1Label`. */
export function tier1LabelSession(
  db: Database,
  sessionId: string,
): SegmentLabel[] {
  return tier1Label(getEventsForSession(db, sessionId), sessionId);
}
