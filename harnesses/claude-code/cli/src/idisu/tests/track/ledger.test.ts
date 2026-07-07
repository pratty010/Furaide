import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import {
  type EventRow,
  getArtifactById,
  getEvidenceLedger,
  insertEvent,
  upsertOutcomeLabel,
} from "../../src/store/repo.js";
import {
  importPreexistingSkills,
  updateEvidenceLedger,
} from "../../src/track/ledger.js";
import { makeTypedEvent } from "../../src/types/events.js";

const dbPath = "/tmp/idisu-ledger-test.sqlite";
const skillsFixtureDir = "/tmp/idisu-ledger-test-skills";

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
  rmSync(skillsFixtureDir, { force: true, recursive: true });
});

afterEach(() => {
  rmSync(dbPath, { force: true });
  rmSync(skillsFixtureDir, { force: true, recursive: true });
});

test("attributionSkill occurrence + success label on its turn segment -> applied+1, win+1, score+1", () => {
  const db = openDb(dbPath);

  // Artifact must exist before it can accumulate ledger entries (evidence_ledger.artifact_id
  // REFERENCES artifacts(id)) — insert directly here rather than going through
  // importPreexistingSkills, since this test is only exercising the ledger join.
  db.query(
    "INSERT INTO artifacts (id,type,origin,state,created_at) VALUES (?,?,?,?,?)",
  ).run(
    "brainstorming",
    "skill",
    "preexisting",
    "active",
    new Date().toISOString(),
  );

  const attribution = makeTypedEvent(
    "capability.invoked",
    "cc:p/s1",
    "0:attribution",
    "claude_code",
    {
      session_id: "s1",
      turn_index: 2,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "chain",
      observability_level: "observed",
      confidence: 1.0,
    },
  );
  insertEvent(db, toRow(attribution));

  upsertOutcomeLabel(db, {
    session_id: "s1",
    segment_key: "turn:2",
    label: "success",
    tier: "deterministic",
  });

  const result = updateEvidenceLedger(db);
  expect(result.updated).toBe(1);

  const row = getEvidenceLedger(db, "brainstorming");
  expect(row?.applied).toBe(1);
  expect(row?.win).toBe(1);
  expect(row?.loss).toBe(0);
  expect(row?.score).toBe(1);
  expect(row?.last_earned_at).not.toBeNull();

  db.close();
});

test("attributionSkill occurrence + failure label (correction proxy substitution) -> applied+1, loss+1, score-1", () => {
  const db = openDb(dbPath);

  db.query(
    "INSERT INTO artifacts (id,type,origin,state,created_at) VALUES (?,?,?,?,?)",
  ).run(
    "brainstorming",
    "skill",
    "preexisting",
    "active",
    new Date().toISOString(),
  );

  const attribution = makeTypedEvent(
    "capability.invoked",
    "cc:p/s2",
    "0:attribution",
    "claude_code",
    {
      session_id: "s2",
      turn_index: 5,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "chain",
      observability_level: "observed",
      confidence: 1.0,
    },
  );
  insertEvent(db, toRow(attribution));

  // No real user-correction detector exists in this codebase yet (per plan
  // research digest — a documented FUTURE metric). The honest substitute:
  // the Judge's failure label on the segment right after skill-attributed
  // work stands in for "the work following this skill's use was corrected."
  upsertOutcomeLabel(db, {
    session_id: "s2",
    segment_key: "turn:5",
    label: "failure",
    tier: "deterministic",
  });

  const result = updateEvidenceLedger(db);
  expect(result.updated).toBe(1);

  const row = getEvidenceLedger(db, "brainstorming");
  expect(row?.applied).toBe(1);
  expect(row?.win).toBe(0);
  expect(row?.loss).toBe(1);
  expect(row?.score).toBe(-1);
  expect(row?.last_earned_at).not.toBeNull();

  db.close();
});

test("unknown/abandoned label -> applied+1 only, no win/loss/score movement", () => {
  const db = openDb(dbPath);

  db.query(
    "INSERT INTO artifacts (id,type,origin,state,created_at) VALUES (?,?,?,?,?)",
  ).run(
    "brainstorming",
    "skill",
    "preexisting",
    "active",
    new Date().toISOString(),
  );

  const attribution = makeTypedEvent(
    "capability.invoked",
    "cc:p/s3",
    "0:attribution",
    "claude_code",
    {
      session_id: "s3",
      turn_index: 1,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "chain",
      observability_level: "observed",
      confidence: 1.0,
    },
  );
  insertEvent(db, toRow(attribution));

  // Session-level fallback label, since no turn:1 row exists.
  upsertOutcomeLabel(db, {
    session_id: "s3",
    segment_key: "session",
    label: "unknown",
    tier: "deterministic",
  });

  const result = updateEvidenceLedger(db);
  expect(result.updated).toBe(1);

  const row = getEvidenceLedger(db, "brainstorming");
  expect(row?.applied).toBe(1);
  expect(row?.win).toBe(0);
  expect(row?.loss).toBe(0);
  expect(row?.score).toBe(0);
  expect(row?.last_earned_at).toBeNull();

  db.close();
});

test("turn-specific label wins over session-level label when both exist", () => {
  const db = openDb(dbPath);

  db.query(
    "INSERT INTO artifacts (id,type,origin,state,created_at) VALUES (?,?,?,?,?)",
  ).run(
    "brainstorming",
    "skill",
    "preexisting",
    "active",
    new Date().toISOString(),
  );

  const attribution = makeTypedEvent(
    "capability.invoked",
    "cc:p/s4",
    "0:attribution",
    "claude_code",
    {
      session_id: "s4",
      turn_index: 3,
      capability_id: "brainstorming",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "chain",
      observability_level: "observed",
      confidence: 1.0,
    },
  );
  insertEvent(db, toRow(attribution));

  // Session-level label says success, but the turn-specific label (failure)
  // should take precedence since it's the more specific segment.
  upsertOutcomeLabel(db, {
    session_id: "s4",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });
  upsertOutcomeLabel(db, {
    session_id: "s4",
    segment_key: "turn:3",
    label: "failure",
    tier: "deterministic",
  });

  updateEvidenceLedger(db);

  const row = getEvidenceLedger(db, "brainstorming");
  expect(row?.win).toBe(0);
  expect(row?.loss).toBe(1);

  db.close();
});

test("attributionSkill occurrence for a skill with no artifacts row is skipped, not fabricated", () => {
  const db = openDb(dbPath);

  const attribution = makeTypedEvent(
    "capability.invoked",
    "cc:p/s5",
    "0:attribution",
    "claude_code",
    {
      session_id: "s5",
      turn_index: 0,
      capability_id: "never-imported",
      capability_type: "skill",
      harness: "claude_code",
      trigger: "chain",
      observability_level: "observed",
      confidence: 1.0,
    },
  );
  insertEvent(db, toRow(attribution));
  upsertOutcomeLabel(db, {
    session_id: "s5",
    segment_key: "session",
    label: "success",
    tier: "deterministic",
  });

  const result = updateEvidenceLedger(db);
  expect(result.updated).toBe(0);
  expect(result.skippedNoArtifact).toBe(1);
  expect(getEvidenceLedger(db, "never-imported")).toBeNull();
  expect(getArtifactById(db, "never-imported")).toBeNull();

  db.close();
});

test("importPreexistingSkills creates artifacts rows (origin='preexisting') for a fixture skills directory", () => {
  const db = openDb(dbPath);

  mkdirSync(join(skillsFixtureDir, "brainstorming"), { recursive: true });
  writeFileSync(
    join(skillsFixtureDir, "brainstorming", "SKILL.md"),
    "# Brainstorming\n",
  );
  mkdirSync(join(skillsFixtureDir, "tdd"), { recursive: true });
  writeFileSync(join(skillsFixtureDir, "tdd", "SKILL.md"), "# TDD\n");
  // Non-directory entry alongside the skill dirs — should be ignored, not crash.
  writeFileSync(join(skillsFixtureDir, "README.md"), "not a skill dir\n");

  const result = importPreexistingSkills(db, skillsFixtureDir);
  expect(result.imported).toBe(2);
  expect(result.skipped).toBe(0);

  const brainstorming = getArtifactById(db, "brainstorming");
  expect(brainstorming?.origin).toBe("preexisting");
  expect(brainstorming?.type).toBe("skill");
  expect(brainstorming?.state).toBe("active");
  expect(brainstorming?.surface_path).toBe(
    join(skillsFixtureDir, "brainstorming", "SKILL.md"),
  );

  const tdd = getArtifactById(db, "tdd");
  expect(tdd?.origin).toBe("preexisting");

  // Idempotent re-run: already-imported dirs are skipped, not duplicated/overwritten.
  const second = importPreexistingSkills(db, skillsFixtureDir);
  expect(second.imported).toBe(0);
  expect(second.skipped).toBe(2);

  db.close();
});

test("importPreexistingSkills no-ops on a missing skills directory", () => {
  const db = openDb(dbPath);
  const result = importPreexistingSkills(
    db,
    join(skillsFixtureDir, "does-not-exist"),
  );
  expect(result.imported).toBe(0);
  expect(result.skipped).toBe(0);
  db.close();
});
