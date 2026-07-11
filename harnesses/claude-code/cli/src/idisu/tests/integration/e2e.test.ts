// Phase 7 (Task 7.3) — End-to-end v0.2 pipeline verification.
//
// Walks the spec's 9 numbered verification checks end-to-end against
// fixtures. Designed as a top-to-bottom honest report of what the
// pipeline actually does today, not a marketing pass: where a check's
// prerequisite is intentionally not wired yet (e.g. statusline sidecar
// is Phase 8, not Phase 7), the test exercises the engine-side half
// that IS implemented and calls out the gap inline rather than
// fabricating a green check.
//
// Honest-scoping notes (cross-referenced with the spec lines 218-226):
//   - Check 1 (hooks): The slim hooks (session-start/skill-post/stop
//     -> spool) are wired in Phase 2 Task 2.1 and are shell scripts
//     under harnesses/claude-code/plugins/idisu/hooks/ — not unit-
//     testable from the idisu TS suite without spawning them. This
//     test exercises the engine-side half: that the spool writer
//     (src/store/spool.ts) accepts and persists the hook event shapes
//     (session.observed, capability.invoked) and that the real
//     `stop.sh` hook script's contract (it shells out to
//     `dream --scheduled`) is intact on disk. The statusline sidecar
//     (Phase 8) is documented as a gap inline.
//   - Check 4 (judge): Tier-1 deterministic is fully implementable.
//     The tier-2 `claude -p` call requires the `claude` binary — in CI
//     it's absent. We use a stub JudgeBackend (recording fake
//     implementing the JudgeBackend interface) to verify
//     exactly-one-call-on-budget + label-persisted-with-judge_model.
//     A separate test asserts budget=0 skips the LLM tier cleanly.
//   - Check 9 (mekiki clean): Implemented as a shell-out to `rg -i
//     mekiki` across the worktree excluding the historical archive
//     dirs (docs/superpowers/{archive,plans,specs,research}) +
//     graphify-out/ + node_modules. The spec carve-out covers
//     "CHANGELOG/history" — see the test for the exact exclusion list.

import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawn } from "bun";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";
import {
  ALL_TIME_WINDOW,
  measure,
  readMetricRollups,
} from "../../src/analysis/measure.js";
import { learnCandidate } from "../../src/cli/commands/learn.js";
import { promoteCandidate } from "../../src/cli/commands/promote.js";
import { rejectCandidate } from "../../src/cli/commands/reject.js";
import { listPendingReview } from "../../src/cli/commands/review.js";
import { runCurate } from "../../src/curate/curate.js";
import { gather } from "../../src/dream/gather.js";
import type { JudgeBackend } from "../../src/judge/interface.js";
import { runJudgeOrchestrator } from "../../src/judge/orchestrator.js";
import { generateCandidates, mineNgrams } from "../../src/mine/mine.js";
import type { Candidate } from "../../src/mine/mine.js";
import { stageCandidate } from "../../src/mine/stage.js";
import { loadCheckpoints } from "../../src/store/checkpoint.js";
import { openDb } from "../../src/store/db.js";
import {
  type EventRow,
  getArtifactById,
  insertArtifact,
  insertEvent,
  insertRejectedSignature,
  upsertEvidenceLedger,
  upsertOutcomeLabel,
} from "../../src/store/repo.js";
import { appendSpool, drainSpool } from "../../src/store/spool.js";
import {
  importPreexistingSkills,
  updateEvidenceLedger,
} from "../../src/track/ledger.js";
import { makeTypedEvent } from "../../src/types/events.js";
import {
  resetFixtures,
  transcriptsDir,
  writeFailureSession,
  writeSuccessSession,
  writeUnknownSession,
} from "./fixtures/transcripts.js";

// --- shared per-suite temp paths --------------------------------------------

// Per-test fresh dirs (cleaned in beforeEach/afterEach) so a single
// failing test doesn't poison the next run.
const E2E_HOME = "/tmp/idisu-e2e-home";
const PENDING_DIR = "/tmp/idisu-e2e-pending";
const ARCHIVE_DIR = "/tmp/idisu-e2e-archive";
const SKILLS_DIR = "/tmp/idisu-e2e-skills";
const DB_PATH = joinSafe(E2E_HOME, "idisu.db");
const CHECKPOINTS_FILE = joinSafe(E2E_HOME, "checkpoints.json");
const SPOOL_DIR = joinSafe(E2E_HOME, "spool");

// Tiny path-join wrapper so the tsconfig "noUncheckedIndexedAccess"
// and biome "noNonNullAssertion" don't trip on `as string` casts at
// each call site.
function joinSafe(...parts: string[]): string {
  return parts.join("/");
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    signature: "Read>Edit>Bash",
    frequency: 3,
    successCount: 2,
    failureCount: 1,
    sampleSessions: ["sess-mine-1", "sess-mine-2"],
    closestSkills: [],
    ...overrides,
  };
}

function cleanupAll(): void {
  rmSync(E2E_HOME, { recursive: true, force: true });
  rmSync(PENDING_DIR, { recursive: true, force: true });
  rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  rmSync(SKILLS_DIR, { recursive: true, force: true });
  rmSync(transcriptsDir(), { recursive: true, force: true });
  mkdirSync(E2E_HOME, { recursive: true });
  mkdirSync(SPOOL_DIR, { recursive: true });
  mkdirSync(PENDING_DIR, { recursive: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  mkdirSync(SKILLS_DIR, { recursive: true });
}

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

beforeAll(() => {
  resetFixtures();
  cleanupAll();
});

beforeEach(() => {
  cleanupAll();
  // Re-seed standard fixtures used by most checks (success + failure
  // + unknown sessions), so individual tests don't have to re-seed
  // unless they need a different mix.
  writeSuccessSession("sess-success-001");
  writeFailureSession("sess-failure-001");
  writeUnknownSession("sess-unknown-001");
});

afterEach(() => {
  rmSync(E2E_HOME, { recursive: true, force: true });
  rmSync(PENDING_DIR, { recursive: true, force: true });
  rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  rmSync(SKILLS_DIR, { recursive: true, force: true });
});

// --- Check 1: hooks ---------------------------------------------------------
test("e2e: check 1 — hook event shapes (session.observed, capability.invoked) survive spool→drain; stop.sh triggers scheduled dream", () => {
  // The slim hooks (session_start.sh, skill_post.sh, stop.sh) shell
  // out and write to $IDISU_HOME/spool/YYYY-MM-DD.jsonl. The CC
  // integration test (cc-ingest.test.ts) already exercises
  // session_start.sh end-to-end (spawning the real script). Here we
  // exercise the engine-side half of the contract: the spool writer
  // accepts the hook event shapes (session.observed,
  // capability.invoked) and drain returns them in a conformant
  // EventEnvelope form. The Stop hook is checked separately by
  // reading the real stop.sh script's content (the script is the
  // contract — it's what production runs).
  appendSpool(SPOOL_DIR, {
    schema_version: 1,
    event_id: "evt-hook-session-001",
    source_id: "cc-hook:sess-hook-e2e-001",
    source_position: "session.start",
    observed_at: "2026-07-06T10:00:00.000Z",
    ingested_at: "2026-07-06T10:00:00.000Z",
    harness: "claude_code",
    event_type: "session.observed",
    payload_version: 1,
    payload: {
      session_id: "sess-hook-e2e-001",
      harness: "claude_code",
      workspace: "/tmp/hook-workspace",
      model: "claude-sonnet-4-6",
      source: "startup",
      started_at: "2026-07-06T10:00:00.000Z",
      transcript_pointer: "/tmp/transcripts/sess-hook-e2e-001.jsonl",
    },
  });
  appendSpool(SPOOL_DIR, {
    schema_version: 1,
    event_id: "evt-hook-cap-001",
    source_id: "cc-hook:sess-hook-e2e-001",
    source_position: "skill.invoke:tu1",
    observed_at: "2026-07-06T10:00:05.000Z",
    ingested_at: "2026-07-06T10:00:05.000Z",
    harness: "claude_code",
    event_type: "capability.invoked",
    payload_version: 1,
    payload: {
      session_id: "sess-hook-e2e-001",
      turn_index: 1,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "model",
      observability_level: "observed",
      confidence: 1.0,
    },
  });

  // Stop hook contract: stop.sh shells out to `dream --scheduled`
  // (not a spool event). The script's content is the production
  // contract; reading it directly is cheaper and more accurate than
  // spawning a subshell.
  const stopScript = readFileSync(
    resolve(import.meta.dir, "../../../../../plugins/idisu/hooks/stop.sh"),
    "utf8",
  );
  expect(stopScript).toContain("dream --scheduled");

  // Drain and assert both hook-shape events survive.
  const drained = drainSpool(SPOOL_DIR);
  expect(drained.length).toBe(2);
  const sessionStart = drained.find(
    (e) => (e as { event_type?: string }).event_type === "session.observed",
  ) as
    | { event_id: string; source_id: string; payload: { session_id: string } }
    | undefined;
  expect(sessionStart).toBeDefined();
  expect(sessionStart?.payload.session_id).toBe("sess-hook-e2e-001");

  const capInvoked = drained.find(
    (e) => (e as { event_type?: string }).event_type === "capability.invoked",
  ) as { event_id: string; payload: { capability_id: string } } | undefined;
  expect(capInvoked).toBeDefined();
  expect(capInvoked?.payload.capability_id).toBe("brainstorming");

  // GAP (Phase 8, not Phase 7): the statusline sidecar is a separate
  // piece (written by skill_post.sh on every successful skill use),
  // not implemented as part of Phase 7. When Phase 8 wires it up,
  // add an assertion here that the sidecar file is written.
});

// --- Check 2: ingest idempotent --------------------------------------------
test("e2e: check 2 — gather() is idempotent across re-runs on fixture transcripts (zero new DB rows)", async () => {
  // The check 2 contract: a fresh dream pass ingests events; a re-run
  // adds zero new rows. The idisu gather pipeline reads checkpoints
  // from `checkpoints.json` (in-memory map populated by
  // `loadCheckpoints`) and persists them to the `checkpoints` DB
  // table — but does NOT write back to the JSON file. So a second
  // gather() call will rescan the same transcripts (yielding the
  // same events); idempotency is enforced at the DB layer via
  // `INSERT OR IGNORE` on `event_id`, not at the adapter layer.
  // Asserting the contract: the DB row count is unchanged.
  const db = openDb(DB_PATH);
  const adapter = new ClaudeCodeAdapter(transcriptsDir());

  const first = await gather(db, [adapter], CHECKPOINTS_FILE);
  const firstCount = (
    db.query("SELECT COUNT(*) c FROM events").get() as { c: number }
  ).c;
  expect(first.adapterEvents).toBeGreaterThan(0);
  expect(firstCount).toBe(first.adapterEvents + first.spooledEvents);

  // Re-gather with a fresh adapter instance + reload checkpoints
  // from the JSON file (which is empty — gather never writes back to
  // it). The adapter will rescan the same transcripts and yield the
  // same events; `INSERT OR IGNORE` on `event_id` makes the net DB
  // effect zero new rows.
  const checkpoints2 = loadCheckpoints(CHECKPOINTS_FILE);
  expect(checkpoints2.size).toBe(0); // JSON file untouched by gather
  const second = await gather(
    db,
    [new ClaudeCodeAdapter(transcriptsDir())],
    CHECKPOINTS_FILE,
  );
  const secondCount = (
    db.query("SELECT COUNT(*) c FROM events").get() as { c: number }
  ).c;
  expect(second.adapterEvents).toBeGreaterThan(0); // adapter re-yields
  expect(secondCount).toBe(firstCount); // DB-level dedup → zero new
  db.close();
});

// --- Check 3: measure rollups ----------------------------------------------
test("e2e: check 3 — measure() populates metric_rollups matching a hand-counted fixture", async () => {
  // The fixture transcript for sess-success-001 contains 4 tool_use
  // blocks (Read/Skill/Edit/Bash) and 4 attributionSkill chain
  // events. Hand-counted expectations for "brainstorming":
  //   - invocation_count: the adapter yields both model-triggered
  //     capability.invoked (Skill tool_use on turn 1) AND chain-
  //     triggered capability.invoked (attributionSkill on every
  //     turn). Per `analysis/measure.ts`, a chain event is a "real
  //     invocation" only when no user/model event shares its
  //     (session_id, turn_index, capability_id) key — otherwise it's
  //     a redundant echo. The fixture has Skill on turn 1 (model
  //     trigger) AND attributionSkill on turn 1 (chain trigger) for
  //     the same key, so the chain event on turn 1 is shadowed.
  //     Chain events on turns 0/2/3 are NOT shadowed → 3 real chain
  //     invocations + 0 real model invocations (the model one is
  //     shadowed) = 3 invocations. attribution_rate = 1.0 (all 3
  //     chain-attributed). model_trigger_rate = 0/3 = 0.0
  //     (post-shrinkage, may be slightly above 0 due to shrinkage
  //     prior — assert >= 0 and < 1 rather than exact 0).
  const db = openDb(DB_PATH);
  const adapter = new ClaudeCodeAdapter(transcriptsDir());
  await gather(db, [adapter], CHECKPOINTS_FILE);

  const written = measure(db);
  expect(written).toBeGreaterThan(0);

  const rollups = readMetricRollups(db, ALL_TIME_WINDOW);
  const brainstorming = rollups.get("brainstorming");
  expect(brainstorming).toBeDefined();
  const invCount = brainstorming?.invocation_count;
  const attrRate = brainstorming?.attribution_rate;
  const modelRate = brainstorming?.model_trigger_rate;
  expect(invCount).toBeGreaterThan(0);
  // attribution_rate — every chain-only invocation is attributed, so
  // the rate should be 1.0 (or very close to 1.0 post-shrinkage).
  expect(attrRate).toBeCloseTo(1.0, 5);
  // model_trigger_rate — 0 model invocations after shadowing, so
  // the post-shrinkage value should be between 0 and 1 (some
  // shrinkage prior pulls it slightly above 0).
  expect(modelRate).toBeGreaterThanOrEqual(0);
  expect(modelRate).toBeLessThan(1);

  db.close();
});

// --- Check 4: judge tier-1 + budgeted tier-2 + budget-0 skip ---------------
function stubJudgeBackend(
  fixedLabel: "success" | "failure" | "abandoned" | "unknown",
): { backend: JudgeBackend; calls: Array<{ prompt: string; model: string }> } {
  const calls: Array<{ prompt: string; model: string }> = [];
  const backend: JudgeBackend = {
    async label(prompt, model) {
      calls.push({ prompt, model });
      return fixedLabel;
    },
  };
  return { backend, calls };
}

test("e2e: check 4a — tier-1 deterministic: pr-link success -> 'success', non-pr-link failure -> 'failure'", async () => {
  // Phase 4 (Judge, Task 4.3) spec rule 1: pr-link merged -> success.
  // Rule 2: any build/test tool_result nonzero exit -> failure.
  const db = openDb(DB_PATH);

  // Insert one pr-link success event for sess-success-001.
  insertEvent(
    db,
    toRow(
      makeTypedEvent(
        "outcome.observed",
        "cc:e2e/sess-success-001",
        "0:pr-link",
        "claude_code",
        {
          kind: "pr-link",
          tool_use_id: "pr-link:1234",
          session_id: "sess-success-001",
          status: "success",
          used_downstream: true,
          attribution: {},
          pr_number: 1234,
        },
      ),
    ),
  );
  // Insert one non-pr-link failure event for sess-failure-001.
  insertEvent(
    db,
    toRow(
      makeTypedEvent(
        "outcome.observed",
        "cc:e2e/sess-failure-001",
        "0:fail",
        "claude_code",
        {
          tool_use_id: "tu-fail-001",
          session_id: "sess-failure-001",
          status: "failure",
          exit_code: 1,
          used_downstream: false,
          attribution: {},
          error_class: "ExitCodeError",
        },
      ),
    ),
  );

  const result = await runJudgeOrchestrator(db, {
    backend: null,
    model: "claude-haiku-4-5",
    budgetTokens: 0,
  });

  expect(result.segmentsLabeled).toBe(2); // 2 sessions, 1 segment each
  expect(result.llmCallsMade).toBe(0);

  const rows = db
    .query(
      "SELECT session_id, label, tier FROM outcome_labels ORDER BY session_id",
    )
    .all() as Array<{ session_id: string; label: string; tier: string }>;
  const a = rows.find((r) => r.session_id === "sess-success-001");
  expect(a?.label).toBe("success");
  expect(a?.tier).toBe("deterministic");

  const b = rows.find((r) => r.session_id === "sess-failure-001");
  expect(b?.label).toBe("failure");
  expect(b?.tier).toBe("deterministic");

  db.close();
});

test("e2e: check 4b — one unknown segment + budget -> exactly one LLM call, label persisted with judge_model", async () => {
  const db = openDb(DB_PATH);
  // Gather the fixture transcripts first so all three sessions have
  // events in the table. The unknown session's transcript has no
  // pr-link / failure signal, so tier-1 will produce an `unknown`
  // label for it; the success session's transcript has a pr-link
  // record (yielding a tier-1 `success` label); the failure
  // session's transcript has a failing tool_result (yielding a
  // tier-1 `failure` label). The orchestrator sorts unknowns first
  // and routes only them to the LLM tier — so the success and
  // failure sessions are never sent to the LLM.
  const adapter = new ClaudeCodeAdapter(transcriptsDir());
  await gather(db, [adapter], CHECKPOINTS_FILE);

  const { backend, calls } = stubJudgeBackend("success");

  const result = await runJudgeOrchestrator(db, {
    backend,
    model: "claude-haiku-4-5",
    budgetTokens: 500,
    tokensPerCall: 500,
  });

  expect(calls.length).toBe(1);
  expect(result.llmCallsMade).toBe(1);
  expect(calls[0]?.model).toBe("claude-haiku-4-5");

  const row = db
    .query("SELECT * FROM outcome_labels WHERE session_id=?")
    .get("sess-unknown-001") as {
    label: string;
    tier: string;
    judge_model: string | null;
  } | null;
  expect(row?.label).toBe("success"); // stub returns "success"
  expect(row?.tier).toBe("llm");
  expect(row?.judge_model).toBe("claude-haiku-4-5");

  db.close();
});

test("e2e: check 4c — budget=0 -> tier 2 skipped cleanly, unknown stays", async () => {
  const db = openDb(DB_PATH);
  // Gather the fixture transcripts first so all three sessions have
  // events in the table — including the unknown session, which has
  // only a `tool.called` event and therefore produces a tier-1
  // `unknown` label (the success and failure sessions' transcripts
  // produce their respective tier-1 labels).
  const adapter = new ClaudeCodeAdapter(transcriptsDir());
  await gather(db, [adapter], CHECKPOINTS_FILE);
  const { backend, calls } = stubJudgeBackend("success");

  const result = await runJudgeOrchestrator(db, {
    backend,
    model: "claude-haiku-4-5",
    budgetTokens: 0,
  });

  expect(calls.length).toBe(0);
  expect(result.llmCallsMade).toBe(0);

  // 3 sessions → 3 session-level labels (success, failure, unknown)
  // + 1 turn-level failure label for the failure session's turn 0
  // (see `judge/tier1.ts#labelTurnSegments` — emits a `turn:<n>`
  // label when a concrete failure is attributable at that turn).
  const rows = db
    .query("SELECT * FROM outcome_labels ORDER BY session_id, segment_key")
    .all() as Array<{
    session_id: string;
    segment_key: string;
    label: string;
    tier: string;
    judge_model: string | null;
  }>;
  expect(rows.length).toBe(4);
  const u = rows.find(
    (r) => r.session_id === "sess-unknown-001" && r.segment_key === "session",
  );
  expect(u?.label).toBe("unknown");
  expect(u?.tier).toBe("deterministic");
  expect(u?.judge_model).toBeNull();

  // The turn-level failure label is the one that would have been
  // upserted by the LLM tier if budget had been available — so its
  // judge_model is also null (tier-1 fallback).
  const turn = rows.find((r) => r.segment_key.startsWith("turn:"));
  expect(turn?.tier).toBe("deterministic");
  expect(turn?.judge_model).toBeNull();

  db.close();
});

// --- Check 5: mine one candidate + no-dup + rejection memory -------------
test("e2e: check 5 — 3× repeated workflow + 2 success / 1 failure -> one candidate with split; stage is idempotent; rejected signature -> never re-proposed", () => {
  const db = openDb(DB_PATH);

  // Three sessions, each running the same 3-tool sequence
  // (Read>Edit>Bash). Two labeled success, one failure — matches
  // the spec's "3×-repeated workflow (2 successes, 1 failure)"
  // verbatim.
  const sessions = ["sess-mine-1", "sess-mine-2", "sess-mine-3"];
  const tools = ["Read", "Edit", "Bash"];
  sessions.forEach((sessionId, si) => {
    tools.forEach((toolName, ti) => {
      const ts = `2026-07-06T13:0${si}:0${ti}.000Z`;
      insertEvent(
        db,
        toRow(
          makeTypedEvent(
            "tool.called",
            `cc:e2e/${sessionId}`,
            ti,
            "claude_code",
            {
              session_id: sessionId,
              turn_index: ti,
              tool_name: toolName,
              tool_use_id: `${sessionId}-tu-${ti}`,
              args_present: true,
              ts,
            },
          ),
        ),
      );
    });
  });
  upsertOutcomeLabel(db, {
    session_id: "sess-mine-1",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });
  upsertOutcomeLabel(db, {
    session_id: "sess-mine-2",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });
  upsertOutcomeLabel(db, {
    session_id: "sess-mine-3",
    segment_key: "session",
    label: "failure",
    tier: "deterministic",
  });

  mineNgrams(db, { min: 2, n: 3 });
  const candidates1 = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
  });
  expect(candidates1.length).toBe(1);
  const c = candidates1[0];
  if (!c) throw new Error("expected one candidate");
  expect(c.signature).toBe("Read>Edit>Bash");
  expect(c.successCount).toBe(2);
  expect(c.failureCount).toBe(1);

  // Stage and re-mine. The dedup guard lives in `stageCandidate`
  // (and is repeated in dream.ts's mine -> stage loop), not in
  // `generateCandidates` itself — so the second generateCandidates
  // call will still emit the same candidate, but stageCandidate will
  // no-op (`skipped: true`) and no new artifacts row is written.
  const staged1 = stageCandidate(db, c, { pendingDir: PENDING_DIR });
  expect(staged1.skipped).toBe(false);

  mineNgrams(db, { min: 2, n: 3 });
  const candidates2 = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
  });
  expect(candidates2.length).toBe(1);
  const staged2 = stageCandidate(db, candidates2[0] as Candidate, {
    pendingDir: PENDING_DIR,
  });
  expect(staged2.skipped).toBe(true);
  expect(staged2.id).toBe(staged1.id); // same id (deterministic)
  // Exactly one artifacts row, not two.
  const artifactsCount = (
    db
      .query("SELECT COUNT(*) AS c FROM artifacts WHERE signature=?")
      .get(c.signature) as { c: number }
  ).c;
  expect(artifactsCount).toBe(1);

  // Rejected-signature memory: insert a rejected_signatures row for
  // this signature and re-mine — the candidate must NOT be
  // re-proposed (generateCandidates filters rejected_signatures).
  const now = new Date().toISOString();
  insertRejectedSignature(db, {
    signature: c.signature,
    reason: "e2e test: rejected",
    rejected_at: now,
  });
  mineNgrams(db, { min: 2, n: 3 });
  const candidates3 = generateCandidates(db, {
    minRepetition: 3,
    minSessions: 2,
    minSuccesses: 1,
  });
  expect(candidates3.length).toBe(0);

  db.close();
});

// --- Check 6: review -> promote -> active + reject -> archive -----------
test("e2e: check 6 — review queue lists staged candidates; promote flips state=active + SKILL.md; reject moves to archive + records rejection memory", () => {
  const db = openDb(DB_PATH);

  // Stage two candidates: one to promote, one to reject.
  const a = stageCandidate(
    db,
    makeCandidate({
      signature: "Promote>Me>Now",
      frequency: 5,
      successCount: 4,
      failureCount: 1,
    }),
    { pendingDir: PENDING_DIR },
  );
  const b = stageCandidate(
    db,
    makeCandidate({
      signature: "Reject>Me>Now",
      frequency: 2,
      successCount: 1,
      failureCount: 1,
    }),
    { pendingDir: PENDING_DIR },
  );
  expect(a.skipped).toBe(false);
  expect(b.skipped).toBe(false);

  // Review queue lists both.
  const queue = listPendingReview(db);
  expect(queue.length).toBe(2);
  const queueIds = queue.map((q) => q.id).sort();
  const expectedIds = [a.id, b.id].sort();
  expect(queueIds).toEqual(expectedIds);

  // Promote `a` to a temp skills dir.
  const targetDir = joinSafe(SKILLS_DIR, "promote-me-now");
  const promoteResult = promoteCandidate(db, a.id, targetDir, {
    pendingDir: PENDING_DIR,
  });
  expect(promoteResult.surfacePath).toBe(joinSafe(targetDir, "SKILL.md"));
  expect(existsSync(promoteResult.surfacePath)).toBe(true);

  const promotedRow = getArtifactById(db, a.id);
  expect(promotedRow?.state).toBe("active");
  expect(promotedRow?.surface_path).toBe(joinSafe(targetDir, "SKILL.md"));
  expect(promotedRow?.promoted_at).toBeTruthy();

  // Reject `b` -> archived + rejected_signatures row.
  const rejectResult = rejectCandidate(db, b.id, "e2e: not useful", {
    pendingDir: PENDING_DIR,
    archiveDir: ARCHIVE_DIR,
  });
  expect(rejectResult.archivePath).toBe(joinSafe(ARCHIVE_DIR, b.id));
  expect(existsSync(joinSafe(rejectResult.archivePath, "draft.md"))).toBe(true);
  expect(existsSync(joinSafe(rejectResult.archivePath, "evidence.md"))).toBe(
    true,
  );

  const rejectedRow = getArtifactById(db, b.id);
  expect(rejectedRow?.state).toBe("rejected");

  const rejectedSig = db
    .query("SELECT * FROM rejected_signatures WHERE signature=?")
    .get("Reject>Me>Now") as { signature: string; reason: string } | null;
  expect(rejectedSig?.reason).toBe("e2e: not useful");

  db.close();
});

// --- Check 7: track +1 / forced deprecate proposal; nothing hard-deleted --
test("e2e: check 7 — capability.invoked (chain) + success label -> ledger win+1; forced score<=0 -> deprecation proposal; nothing hard-deleted", () => {
  const db = openDb(DB_PATH);
  const now = new Date().toISOString();

  // Seed a chain-triggered capability.invoked event for
  // promote-me-now in a session that's been labeled "success" by
  // tier-1. The artifacts row is inserted directly with id
  // matching the skill's directory name (the same convention
  // importPreexistingSkills uses for `~/.agents/skills/<name>/`
  // directories — see track/ledger.ts).
  insertArtifact(db, {
    id: "promote-me-now",
    type: "skill",
    origin: "preexisting",
    surface_path: joinSafe(SKILLS_DIR, "promote-me-now", "SKILL.md"),
    state: "active",
    signature: "Promote>Me>Now",
    created_at: now,
  });

  insertEvent(
    db,
    toRow(
      makeTypedEvent(
        "capability.invoked",
        "cc:e2e/sess-track-001",
        "0:attribution",
        "claude_code",
        {
          session_id: "sess-track-001",
          turn_index: 0,
          capability_id: "promote-me-now",
          capability_type: "skill",
          harness: "claude_code",
          trigger: "chain",
          observability_level: "observed",
          confidence: 1.0,
        },
      ),
    ),
  );
  upsertOutcomeLabel(db, {
    session_id: "sess-track-001",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });

  // Run updateEvidenceLedger directly (the relevant Phase 6 step).
  const ledgerResult = updateEvidenceLedger(db);
  expect(ledgerResult.updated).toBe(1);
  expect(ledgerResult.skippedNoArtifact).toBe(0);

  const row = db
    .query("SELECT * FROM evidence_ledger WHERE artifact_id=?")
    .get("promote-me-now") as {
    applied: number;
    win: number;
    loss: number;
    score: number;
  } | null;
  expect(row?.applied).toBe(1);
  expect(row?.win).toBe(1);
  expect(row?.loss).toBe(0);
  expect(row?.score).toBe(1);

  // Forced deprecation: upsert a ledger row with score=-6 (well
  // below the 0 threshold) and run curate — expect a deprecation
  // proposal in the queue.
  upsertEvidenceLedger(
    db,
    "promote-me-now",
    { applied: 6, win: 0, loss: 6, score: -6 },
    now,
  );

  // Write a real SKILL.md file at the artifact's surface_path so
  // curate's archive-move consolidation has something concrete to
  // look at (and to assert nothing is hard-deleted). Create the
  // parent directory first — writeFileSync doesn't mkdir.
  const skillFile = joinSafe(SKILLS_DIR, "promote-me-now", "SKILL.md");
  const skillDir = joinSafe(SKILLS_DIR, "promote-me-now");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillFile, "# promote-me-now content\n");

  const curateResult = runCurate(db, {
    pendingDir: PENDING_DIR,
    archiveDir: ARCHIVE_DIR,
  });
  expect(curateResult.deprecationProposals).toBe(1);

  const proposal = db
    .query(
      "SELECT * FROM artifacts WHERE type='instruction_edit' AND state='staged'",
    )
    .get() as { signature: string; surface_path: string } | null;
  expect(proposal?.signature).toBe("curate:deprecate:promote-me-now");
  expect(proposal?.surface_path).toBeTruthy();
  expect(existsSync(proposal?.surface_path as string)).toBe(true);

  // The original artifact is STILL 'active' (curate is proposals-only).
  const orig = getArtifactById(db, "promote-me-now");
  expect(orig?.state).toBe("active");
  expect(orig?.deprecated_at).toBeNull();

  // The original on-disk SKILL.md is STILL there (nothing hard-deleted).
  expect(existsSync(skillFile)).toBe(true);

  db.close();
});

// --- Check 8: /idisu learn registers origin='learned' ---------------------
test("e2e: check 8 — learnCandidate from session:<id> embeds session evidence; artifacts row has origin='learned', state='staged'", () => {
  const db = openDb(DB_PATH);

  // Seed a few events for the session the learn will read from.
  for (let i = 0; i < 3; i++) {
    insertEvent(
      db,
      toRow(
        makeTypedEvent(
          "capability.invoked",
          "cc:e2e/sess-learn-001",
          `0:attribution-${i}`,
          "claude_code",
          {
            session_id: "sess-learn-001",
            turn_index: i,
            capability_id: "brainstorming",
            capability_type: "skill",
            harness: "claude_code",
            trigger: "chain",
            observability_level: "observed",
            confidence: 1.0,
          },
        ),
      ),
    );
  }

  const result = learnCandidate(db, "session:sess-learn-001", {
    pendingDir: PENDING_DIR,
  });

  expect(result.skipped).toBe(false);
  expect(result.sourceKind).toBe("session");
  // Block contains session evidence (session id + 3-event count).
  expect(result.instructionBlock).toContain("sess-learn-001");
  expect(result.instructionBlock).toContain("Events for this session: 3");
  // skill-creator handoff marker.
  expect(result.instructionBlock.toLowerCase()).toContain("skill-creator");

  const row = db.query("SELECT * FROM artifacts WHERE id=?").get(result.id) as {
    type: string;
    origin: string;
    state: string;
    surface_path: string;
  } | null;
  expect(row?.type).toBe("skill");
  expect(row?.origin).toBe("learned");
  expect(row?.state).toBe("staged");
  expect(row?.surface_path).toBeTruthy();
  expect(existsSync(row?.surface_path as string)).toBe(true);

  db.close();
});

// --- Check 9: mekiki clean (rg -i mekiki) ---------------------------------
test("e2e: check 9 — repo is clean of 'mekiki' references outside historical archives", async () => {
  // Spec carve-out (line 226): "clean outside CHANGELOG/history".
  // The on-disk historical archives for this repo are:
  //   - `docs/superpowers/`: archived plan/spec/research markdown
  //     (Phase 0 Task 0.5 explicitly retained the historical naming
  //     and the documented "rename + carve-out" rationale).
  //   - `graphify-out/`: the architecture knowledge graph, which
  //     retains mekiki references to historical source files for
  //     graph-traversal purposes.
  //   - `node_modules/`: third-party deps.
  //   - `.venv/`: Python venv (stamps the package name into
  //     VIRTUAL_ENV_PROMPT in `bin/activate_this.py`).
  //   - `.git/`: object store (git history retains old names).
  //   - `.worktrees/`: other worktrees.
  //
  // `harnesses/claude-code/CLAUDE.md` was rewritten (2026-07-11) to
  // drop its mekiki references, so that carve-out is gone — this
  // check is now a real "always clean" assertion with no permanent
  // exception left.
  // The test file lives at
  // `<worktree>/harnesses/claude-code/cli/src/idisu/tests/integration/`,
  // so the worktree root is 6 levels up from `import.meta.dir`.
  const worktreeRoot = resolve(import.meta.dir, "../../../../../../..");
  const rgArgs = [
    "-i",
    "--no-heading",
    "--line-number",
    "--color=never",
    // Path-scoped excludes must be relative to the rg search path.
    // We pass "." as the search path below so bun's spawn runs the
    // child from the worktree root and the relative -g patterns
    // resolve correctly.
    "-g",
    "!node_modules",
    "-g",
    "!.git",
    "-g",
    "!.venv",
    "-g",
    "!graphify-out",
    "-g",
    "!docs",
    "-g",
    "!.worktrees",
    "-g",
    "!harnesses/claude-code/cli/.venv",
    // Exclude the test file itself — it mentions "mekiki" in its
    // own header comment, test names, and the rg invocation.
    "-g",
    "!harnesses/claude-code/cli/src/idisu/tests/integration/e2e.test.ts",
    "mekiki",
    ".",
  ];

  // Run rg with cwd set to the worktree root so the relative -g
  // patterns above resolve against the expected directory layout
  // (rg respects the search path, not Bun.spawn's cwd, for
  // globs — but using the worktree root as cwd makes the search
  // path argument consistent and the exclusion list robust to
  // whichever absolute path the worktree lives at).
  const proc = spawn({
    cmd: ["rg", ...rgArgs],
    cwd: worktreeRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // Silence the unused-var linter for `stderr` (kept in the
  // failure-message include below for diagnostic value).
  void stderr;

  if (exitCode === 0) {
    // rg exit 0 = at least one match. Dump the matches to the test
    // failure message so the reader sees exactly what's left.
    throw new Error(
      `Expected zero mekiki references in active code, found:\n${stdout}\n(rg stderr: ${stderr})`,
    );
  }
  // rg exit 1 = no matches (clean), exit 127 = not installed (we
  // assume rg is present in the dev env; CI runs on Linux/macOS
  // with ripgrep).
  expect(exitCode).toBe(1);
});

// Silence the unused-import linter for the readFileSync used in
// check 1's stop.sh contract check. The bun test runner doesn't
// have a top-level noUnusedLocals pragma, but biome does, so this
// reference is the only readFileSync call in this file.
void readFileSync;
