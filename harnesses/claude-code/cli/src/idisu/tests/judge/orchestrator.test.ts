import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { openDb } from "../../src/store/db.js";
import { insertEvent } from "../../src/store/repo.js";
import { runJudgeOrchestrator } from "../../src/judge/orchestrator.js";
import type { JudgeBackend } from "../../src/judge/interface.js";

// Fixture: 3 segments across 3 sessions — matches Task 4.3 Step 1's "3
// segments, 2 labeled by Tier-1, 1 unknown" spec. Using separate sessions
// (rather than 3 segments within one session) keeps the fixture simple:
// Tier-1's rules are session-scoped first, so mixing a failing tool call and
// an "unknown" session-level result inside the *same* session isn't
// possible (any failure event forces that session's own label to
// "failure").
//   - sess-a: pr-link merged -> success (Tier-1, non-unknown)
//   - sess-b: failing non-pr-link outcome -> failure (Tier-1, non-unknown)
//   - sess-c: no usable signal -> unknown (Tier-1)

function seedFixture(dbPath: string) {
  rmSync(dbPath, { force: true });
  const db = openDb(dbPath);

  insertEvent(db, {
    event_id: "evt-a-pr",
    schema_version: 1,
    source_id: "cc:proj/sess-a",
    source_position: 0,
    observed_at: "2026-07-06T10:00:00.000Z",
    ingested_at: "2026-07-06T10:00:00.000Z",
    harness: "claude_code",
    event_type: "outcome.observed",
    payload_version: 1,
    payload: {
      kind: "pr-link",
      session_id: "sess-a",
      status: "success",
      tool_use_id: "toolu_a1",
      used_downstream: true,
      attribution: {},
    },
  });

  insertEvent(db, {
    event_id: "evt-b-fail",
    schema_version: 1,
    source_id: "cc:proj/sess-b",
    source_position: 0,
    observed_at: "2026-07-06T11:00:00.000Z",
    ingested_at: "2026-07-06T11:00:00.000Z",
    harness: "claude_code",
    event_type: "outcome.observed",
    payload_version: 1,
    payload: {
      kind: "test",
      session_id: "sess-b",
      status: "failure",
      tool_use_id: "toolu_b1",
      used_downstream: false,
      attribution: {},
    },
  });

  insertEvent(db, {
    event_id: "evt-c-noop",
    schema_version: 1,
    source_id: "cc:proj/sess-c",
    source_position: 0,
    observed_at: "2026-07-06T12:00:00.000Z",
    ingested_at: "2026-07-06T12:00:00.000Z",
    harness: "claude_code",
    event_type: "tool.called",
    payload_version: 1,
    payload: {
      session_id: "sess-c",
      turn_index: 0,
      tool_name: "Read",
      tool_use_id: "toolu_c1",
      args_present: true,
      ts: "2026-07-06T12:00:00.000Z",
    },
  });

  return db;
}

function stubBackend(fixedLabel: "success" | "failure" | "abandoned" | "unknown") {
  const calls: Array<{ prompt: string; model: string }> = [];
  const backend: JudgeBackend = {
    async label(prompt, model) {
      calls.push({ prompt, model });
      return fixedLabel;
    },
  };
  return { backend, calls };
}

test("orchestrator: budget for exactly 1 call -> exactly one backend call, llm label persisted with judge_model", async () => {
  const dbPath = "/tmp/idisu-orchestrator-test-budget1.sqlite";
  const db = seedFixture(dbPath);
  const { backend, calls } = stubBackend("success");

  const result = await runJudgeOrchestrator(db, {
    backend,
    model: "claude-haiku-4-5",
    budgetTokens: 500,
    tokensPerCall: 500,
  });

  expect(calls.length).toBe(1);
  expect(result.llmCallsMade).toBe(1);

  const rows = db
    .query("SELECT * FROM outcome_labels ORDER BY session_id")
    .all() as Array<{
    session_id: string;
    segment_key: string;
    label: string;
    tier: string;
    judge_model: string | null;
  }>;

  expect(rows.length).toBe(3);

  const a = rows.find((r) => r.session_id === "sess-a");
  expect(a?.label).toBe("success");
  expect(a?.tier).toBe("deterministic");

  const b = rows.find((r) => r.session_id === "sess-b");
  expect(b?.label).toBe("failure");
  expect(b?.tier).toBe("deterministic");

  const c = rows.find((r) => r.session_id === "sess-c");
  expect(c?.label).toBe("success"); // stub backend's fixed verdict
  expect(c?.tier).toBe("llm");
  expect(c?.judge_model).toBe("claude-haiku-4-5");

  db.close();
  rmSync(dbPath, { force: true });
});

test("orchestrator: budget 0 -> zero backend calls, unknown stays", async () => {
  const dbPath = "/tmp/idisu-orchestrator-test-budget0.sqlite";
  const db = seedFixture(dbPath);
  const { backend, calls } = stubBackend("success");

  const result = await runJudgeOrchestrator(db, {
    backend,
    model: "claude-haiku-4-5",
    budgetTokens: 0,
    tokensPerCall: 500,
  });

  expect(calls.length).toBe(0);
  expect(result.llmCallsMade).toBe(0);

  const rows = db
    .query("SELECT * FROM outcome_labels ORDER BY session_id")
    .all() as Array<{ session_id: string; label: string; tier: string }>;

  expect(rows.length).toBe(3);
  const c = rows.find((r) => r.session_id === "sess-c");
  expect(c?.label).toBe("unknown");
  expect(c?.tier).toBe("deterministic");

  db.close();
  rmSync(dbPath, { force: true });
});

test("orchestrator: null backend (unavailable) -> zero calls, tier-1 labels still persisted", async () => {
  const dbPath = "/tmp/idisu-orchestrator-test-nobackend.sqlite";
  const db = seedFixture(dbPath);

  const result = await runJudgeOrchestrator(db, {
    backend: null,
    model: "claude-haiku-4-5",
    budgetTokens: 50_000,
  });

  expect(result.llmCallsMade).toBe(0);
  const rows = db.query("SELECT * FROM outcome_labels").all() as Array<{
    label: string;
  }>;
  expect(rows.length).toBe(3);

  db.close();
  rmSync(dbPath, { force: true });
});
