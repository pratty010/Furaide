import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tier1Label, tier1LabelSession } from "../../src/judge/tier1.js";
import { openDb } from "../../src/store/db.js";
import { insertEvent } from "../../src/store/repo.js";
import type { EventEnvelope } from "../../src/types/events.js";

function ev(
  overrides: Partial<EventEnvelope> & { payload: Record<string, unknown> },
): EventEnvelope {
  return {
    schema_version: 1,
    event_id: overrides.event_id ?? Math.random().toString(36).slice(2),
    source_id: overrides.source_id ?? "src",
    source_position: overrides.source_position ?? 0,
    observed_at: overrides.observed_at ?? "2026-07-06T10:00:00.000Z",
    ingested_at: overrides.ingested_at ?? "2026-07-06T10:00:00.000Z",
    harness: overrides.harness ?? "claude_code",
    event_type: overrides.event_type ?? "outcome.observed",
    payload_version: overrides.payload_version ?? 1,
    payload: overrides.payload,
  };
}

// ── Rule 1: pr-link merged -> success ─────────────────────────────────────────

test("tier1Label: pr-link merged session -> success, deterministic, evidence_ref set", () => {
  const sessionId = "sess-pr-success";
  const prEvent = ev({
    event_id: "evt-pr-1",
    event_type: "outcome.observed",
    payload: {
      kind: "pr-link",
      session_id: sessionId,
      status: "success",
      used_downstream: true,
      attribution: {},
    },
  });
  const labels = tier1Label([prEvent], sessionId);
  const session = labels.find((l) => l.segment_key === "session");

  expect(session).toBeDefined();
  expect(session?.label).toBe("success");
  expect(session?.tier).toBe("deterministic");
  expect(session?.evidence_ref).toBe("evt-pr-1");
  expect(session?.session_id).toBe(sessionId);
});

// ── Rule 2: failing test/build tool_result (nonzero exit) -> failure ─────────
// Also covers "mid-task truncation": the session has no pr-link, no
// session.observed ended_cleanly signal, and simply stops after the failing
// tool result — i.e. no positive signal exists to override the failure.

test("tier1Label: failing test exit code + mid-task truncation -> failure", () => {
  const sessionId = "sess-fail-truncated";
  const toolCalled = ev({
    event_id: "evt-tool-called-1",
    event_type: "tool.called",
    payload: {
      session_id: sessionId,
      turn_index: 3,
      tool_name: "Bash",
      tool_use_id: "toolu_1",
      args_present: true,
      ts: "2026-07-06T10:00:01.000Z",
    },
  });
  const failingOutcome = ev({
    event_id: "evt-outcome-fail-1",
    event_type: "outcome.observed",
    payload: {
      tool_use_id: "toolu_1",
      session_id: sessionId,
      status: "failure",
      exit_code: 1,
      used_downstream: false,
      attribution: {},
    },
  });
  const labels = tier1Label([toolCalled, failingOutcome], sessionId);
  const session = labels.find((l) => l.segment_key === "session");

  expect(session?.label).toBe("failure");
  expect(session?.tier).toBe("deterministic");
  expect(session?.evidence_ref).toBe("evt-outcome-fail-1");

  // Per-workflow-segment granularity: the specific turn that failed is
  // labeled independently of the whole-session rollup.
  const turnSegment = labels.find((l) => l.segment_key === "turn:3");
  expect(turnSegment).toBeDefined();
  expect(turnSegment?.label).toBe("failure");
  expect(turnSegment?.evidence_ref).toBe("evt-outcome-fail-1");
});

test("tier1Label: pr-link success is checked before failure signals (priority order)", () => {
  const sessionId = "sess-pr-over-failure";
  const failingOutcome = ev({
    event_id: "evt-outcome-fail-2",
    event_type: "outcome.observed",
    payload: {
      tool_use_id: "toolu_2",
      session_id: sessionId,
      status: "failure",
      exit_code: 1,
      used_downstream: false,
      attribution: {},
    },
  });
  const prEvent = ev({
    event_id: "evt-pr-2",
    event_type: "outcome.observed",
    payload: {
      kind: "pr-link",
      session_id: sessionId,
      status: "success",
      used_downstream: true,
      attribution: {},
    },
  });
  const labels = tier1Label([failingOutcome, prEvent], sessionId);
  const session = labels.find((l) => l.segment_key === "session");

  expect(session?.label).toBe("success");
  expect(session?.evidence_ref).toBe("evt-pr-2");
});

// ── Rule 4: clean Stop proxy -> success ───────────────────────────────────────
// Documented gap: no adapter in this codebase sets `ended_cleanly` today
// (see dream/consolidate.ts's rollupSessions doc comment for the same gap on
// `model`/`cwd`). This rule only fires when a `session.observed` payload
// explicitly reports `ended_cleanly: true` — it does not infer a clean stop
// merely from the absence of a failure signal.

test("tier1Label: session.observed ended_cleanly:true with no failure -> success (clean-stop proxy)", () => {
  const sessionId = "sess-clean-stop";
  const sessionObserved = ev({
    event_id: "evt-session-observed-1",
    event_type: "session.observed",
    payload: {
      session_id: sessionId,
      harness: "claude_code",
      started_at: "2026-07-06T10:00:00.000Z",
      ended_cleanly: true,
      transcript_pointer: "/tmp/x.jsonl",
    },
  });
  const labels = tier1Label([sessionObserved], sessionId);
  const session = labels.find((l) => l.segment_key === "session");

  expect(session?.label).toBe("success");
  expect(session?.evidence_ref).toBe("evt-session-observed-1");
});

// ── Fallback: no usable signal -> unknown ────────────────────────────────────

test("tier1Label: no pr-link, no failure, no ended_cleanly signal -> unknown", () => {
  const sessionId = "sess-no-signal";
  const toolCalled = ev({
    event_id: "evt-tool-called-2",
    event_type: "tool.called",
    payload: {
      session_id: sessionId,
      turn_index: 0,
      tool_name: "Read",
      tool_use_id: "toolu_3",
      args_present: true,
      ts: "2026-07-06T10:00:00.000Z",
    },
  });
  const labels = tier1Label([toolCalled], sessionId);
  const session = labels.find((l) => l.segment_key === "session");

  expect(session?.label).toBe("unknown");
  expect(session?.tier).toBe("deterministic");
});

test("tier1Label: empty event set -> unknown", () => {
  const labels = tier1Label([], "sess-empty");
  const session = labels.find((l) => l.segment_key === "session");
  expect(session?.label).toBe("unknown");
});

// ── DB-backed wrapper (tier1LabelSession) ────────────────────────────────────

test("tier1LabelSession: queries idisu.db via store primitives and matches pure tier1Label", () => {
  const p = "/tmp/idisu-tier1-test.sqlite";
  rmSync(p, { force: true });
  const db = openDb(p);
  const sessionId = "sess-db-backed";

  insertEvent(db, {
    event_id: "evt-db-pr-1",
    schema_version: 1,
    source_id: "cc:proj/sess-db-backed",
    source_position: 0,
    observed_at: "2026-07-06T10:00:00.000Z",
    ingested_at: "2026-07-06T10:00:00.000Z",
    harness: "claude_code",
    event_type: "outcome.observed",
    payload_version: 1,
    payload: {
      kind: "pr-link",
      session_id: sessionId,
      status: "success",
      used_downstream: true,
      attribution: {},
    },
  });

  const labels = tier1LabelSession(db, sessionId);
  const session = labels.find((l) => l.segment_key === "session");
  expect(session?.label).toBe("success");
  expect(session?.evidence_ref).toBe("evt-db-pr-1");

  db.close();
  rmSync(p, { force: true });
});
