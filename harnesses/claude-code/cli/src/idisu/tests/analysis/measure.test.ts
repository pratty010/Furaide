import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { measure } from "../../src/analysis/measure.js";
import { openDb } from "../../src/store/db.js";
import { type EventRow, insertEvent } from "../../src/store/repo.js";
import { makeTypedEvent } from "../../src/types/events.js";

const dbPath = "/tmp/idisu-measure-test.sqlite";

function toRow(ev: ReturnType<typeof makeTypedEvent>): EventRow {
  return {
    event_id: ev.event_id,
    schema_version: ev.schema_version,
    source_id: ev.source_id,
    source_position: ev.source_position,
    observed_at: ev.observed_at,
    ingested_at: ev.ingested_at,
    harness: ev.harness,
    event_type: ev.event_type,
    payload_version: ev.payload_version,
    payload: ev.payload,
  };
}

beforeEach(() => {
  rmSync(dbPath, { force: true });
});

afterEach(() => {
  rmSync(dbPath, { force: true });
});

test("measure writes invocation_count, model_trigger_rate, attribution_rate to metric_rollups", () => {
  const db = openDb(dbPath);

  // Fixture: one capability ("brainstorming"), 3 "real" invocations —
  // 1 typed/explicit (trigger:'user'), 2 model-triggered (trigger:'model').
  // Of those 3, 2 (the typed one + the first model one) have a matching
  // attributionSkill-derived confirmation: a separate capability.invoked
  // event with trigger:'chain', same session_id + turn_index + capability_id,
  // mirroring how ClaudeCodeAdapter emits attributionSkill echoes.
  const events = [
    makeTypedEvent("capability.invoked", "cc:p/s1", 0, "claude_code", {
      session_id: "s1",
      turn_index: 0,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "user",
      observability_level: "observed",
      confidence: 1.0,
      tool_use_id: "toolu_01",
    }),
    makeTypedEvent(
      "capability.invoked",
      "cc:p/s1",
      "0:attribution",
      "claude_code",
      {
        session_id: "s1",
        turn_index: 0,
        capability_id: "brainstorming",
        capability_type: "skill",
        harness: "claude_code",
        trigger: "chain",
        observability_level: "observed",
        confidence: 1.0,
      },
    ),
    makeTypedEvent("capability.invoked", "cc:p/s2", 0, "claude_code", {
      session_id: "s2",
      turn_index: 0,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "model",
      observability_level: "observed",
      confidence: 1.0,
      tool_use_id: "toolu_02",
    }),
    makeTypedEvent(
      "capability.invoked",
      "cc:p/s2",
      "0:attribution",
      "claude_code",
      {
        session_id: "s2",
        turn_index: 0,
        capability_id: "brainstorming",
        capability_type: "skill",
        harness: "claude_code",
        trigger: "chain",
        observability_level: "observed",
        confidence: 1.0,
      },
    ),
    makeTypedEvent("capability.invoked", "cc:p/s3", 0, "claude_code", {
      session_id: "s3",
      turn_index: 0,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "model",
      observability_level: "observed",
      confidence: 1.0,
      tool_use_id: "toolu_03",
    }),
  ];

  for (const ev of events) insertEvent(db, toRow(ev));

  const written = measure(db);
  expect(written).toBeGreaterThan(0);

  const rows = db
    .query(
      `SELECT metric, value FROM metric_rollups WHERE capability = ? AND window = ? ORDER BY metric ASC`,
    )
    .all("brainstorming", "all_time") as { metric: string; value: number }[];

  const byMetric = new Map(rows.map((r) => [r.metric, r.value]));

  expect(byMetric.get("invocation_count")).toBe(3);
  expect(byMetric.get("model_trigger_rate")).toBeCloseTo(2 / 3, 3);
  expect(byMetric.get("attribution_rate")).toBeCloseTo(2 / 3, 3);

  db.close();
});

test("measure counts a chain-only capability (no matching user/model event) rather than dropping it", () => {
  const db = openDb(dbPath);

  // Fixture mirrors ClaudeCodeAdapter's deepAssistantTurn test case: a turn
  // where `attributionSkill: 'tdd'` is set but the only tool_use blocks are
  // Read/Bash (no Skill tool_use) — so 'tdd's ONLY capability.invoked event
  // is trigger:'chain', with no 'user'/'model' event sharing its
  // (session_id, turn_index, capability_id) key. This must still surface as
  // a real invocation, not be silently dropped.
  const events = [
    makeTypedEvent(
      "capability.invoked",
      "cc:p/s1",
      "0:attribution",
      "claude_code",
      {
        session_id: "s1",
        turn_index: 0,
        capability_id: "tdd",
        capability_type: "skill",
        harness: "claude_code",
        trigger: "chain",
        observability_level: "observed",
        confidence: 1.0,
      },
    ),
  ];

  for (const ev of events) insertEvent(db, toRow(ev));

  const written = measure(db);
  expect(written).toBeGreaterThan(0);

  const rows = db
    .query(
      `SELECT metric, value FROM metric_rollups WHERE capability = ? AND window = ? ORDER BY metric ASC`,
    )
    .all("tdd", "all_time") as { metric: string; value: number }[];

  const byMetric = new Map(rows.map((r) => [r.metric, r.value]));

  expect(byMetric.get("invocation_count")).toBe(1);

  db.close();
});

test("measure is idempotent — re-running upserts rather than duplicating rows", () => {
  const db = openDb(dbPath);

  const events = [
    makeTypedEvent("capability.invoked", "cc:p/s1", 0, "claude_code", {
      session_id: "s1",
      turn_index: 0,
      capability_id: "tdd",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "model",
      observability_level: "observed",
      confidence: 1.0,
      tool_use_id: "toolu_01",
    }),
  ];
  for (const ev of events) insertEvent(db, toRow(ev));

  measure(db);
  measure(db);

  const rows = db
    .query(
      `SELECT COUNT(*) c FROM metric_rollups WHERE capability = ? AND metric = 'invocation_count'`,
    )
    .get("tdd") as { c: number };

  expect(rows.c).toBe(1);

  db.close();
});
