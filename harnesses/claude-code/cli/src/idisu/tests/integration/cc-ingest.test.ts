import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { gather } from "../../src/dream/gather.js";
import { openDb } from "../../src/store/db.js";
import { appendEvent, readEvents } from "../../src/store/event-log.js";
import { insertEvent } from "../../src/store/repo.js";
import { countEvents } from "../../src/store/repo.js";
import { drainSpool } from "../../src/store/spool.js";
import { ĪdisuCache } from "../../src/store/sqlite-cache.js";
import { EventEnvelopeSchema } from "../../src/types/events.js";

// Path to the real plugin hook script, so this test exercises the actual
// shell code that runs in production, not a hand-crafted stand-in.
const SESSION_START_HOOK = join(
  import.meta.dir,
  "../../../../../plugins/idisu/hooks/session_start.sh",
);

const TMP = "/tmp/idisu-integration-test";
const EVENTS_DIR = join(TMP, "events");
const DB_PATH = join(TMP, "cache.sqlite");
const PROJ_DIR = join(TMP, "transcripts", "my-project");

mkdirSync(PROJ_DIR, { recursive: true });

const sessionId = "sess-integration-001";
const lines = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    parentUuid: null,
    isSidechain: false,
    isMeta: false,
    ts: "2026-06-17T10:00:00.000Z",
    message: { role: "user", content: "brainstorm a feature" },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    parentUuid: "u1",
    isSidechain: false,
    isMeta: false,
    ts: "2026-06-17T10:00:02.000Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [
        {
          type: "tool_use",
          id: "toolu_99",
          name: "Skill",
          input: { skill: "brainstorming" },
        },
      ],
      usage: { input_tokens: 200, output_tokens: 80 },
    },
  }),
];
writeFileSync(join(PROJ_DIR, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);

afterAll(() => rmSync(TMP, { recursive: true }));

test("end-to-end: CC transcript → event log → FTS5 cache → BM25 query", async () => {
  const adapter = new ClaudeCodeAdapter(join(TMP, "transcripts"));
  const checkpoints = new Map();
  const events: import("../../src/types/events.js").EventEnvelope[] = [];
  for await (const ev of adapter.scan(checkpoints)) {
    events.push(ev);
    appendEvent(ev, EVENTS_DIR);
  }

  const capEvents = events.filter((e) => e.event_type === "capability.invoked");
  expect(capEvents.length).toBe(1);
  expect(
    (capEvents[0]?.payload as { capability_id: string }).capability_id,
  ).toBe("brainstorming");

  const partition = capEvents[0]!.observed_at.slice(0, 10);
  const readBack = [...readEvents(partition, "claude_code", EVENTS_DIR)];
  expect(readBack.some((e) => e.event_type === "capability.invoked")).toBe(
    true,
  );

  const cache = new ĪdisuCache(DB_PATH);
  cache.upsertCapability({
    capability_id: "brainstorming",
    name: "Brainstorming",
    description: "Explores user intent and requirements before building",
    harness: "claude_code",
    type: "skill",
    path: "/skills/brainstorming/SKILL.md",
    content_hash: "deadbeef",
    trigger_hints: ["feature", "design", "create"],
    scanned_at: "2026-06-17T10:00:00Z",
  });
  const results = cache.bm25Search("brainstorm feature", 5);
  expect(results[0]?.capability_id).toBe("brainstorming");
  cache.close();
});

test("gather drains spool + adapters into idisu.db idempotently across two runs", async () => {
  const dir = "/tmp/idisu-gather-ingest-test";
  rmSync(dir, { recursive: true, force: true });
  const transcriptsDir = join(dir, "transcripts");
  const projDir = join(transcriptsDir, "my-project");
  mkdirSync(projDir, { recursive: true });

  const gatherSessionId = "sess-gather-001";
  const gatherLines = [
    JSON.stringify({
      type: "assistant",
      uuid: "a1",
      parentUuid: null,
      isSidechain: false,
      isMeta: false,
      ts: "2026-07-06T10:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: "toolu_g1",
            name: "Skill",
            input: { skill: "brainstorming" },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }),
  ];
  writeFileSync(
    join(projDir, `${gatherSessionId}.jsonl`),
    `${gatherLines.join("\n")}\n`,
  );

  const dbPath = join(dir, "idisu.db");
  const checkpointsFile = join(dir, "checkpoints.json");
  const db = openDb(dbPath);
  const adapter = new ClaudeCodeAdapter(transcriptsDir);

  const first = await gather(db, [adapter], checkpointsFile);
  expect(first.adapterEvents).toBeGreaterThan(0);
  const firstCount = countEvents(db);
  expect(firstCount).toBe(first.adapterEvents + first.spooledEvents);

  const second = await gather(db, [adapter], checkpointsFile);
  const secondCount = countEvents(db);
  expect(secondCount).toBe(firstCount); // checkpoint + INSERT OR IGNORE dedup — zero new rows

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("session_start.sh hook emits a conformant session.observed envelope that survives the spool-drain path into idisu.db", () => {
  // Regression test for the Phase 2 review defect: session_start.sh used to
  // emit a raw, non-EventEnvelope-shaped line ({ts, hook_event_id, platform,
  // event: "session.start", ...}) that EventEnvelopeSchema.safeParse()
  // silently rejected inside gather() — so no session.observed event ever
  // reached idisu.db, and rollupSessions() could never populate `model`/`cwd`.
  //
  // This test invokes the *actual* hook script (not a hand-crafted stand-in)
  // and then runs its output through the identical drainSpool() +
  // EventEnvelopeSchema.safeParse() + insertEvent() sequence gather() uses
  // internally (gather() itself reads a module-level SPOOL_DIR constant
  // derived from IDISU_HOME at import time, so it can't be redirected to a
  // scratch dir mid-suite — this replicates its spool-handling logic exactly
  // against a scratch spool dir instead). It asserts the row lands in
  // idisu.db's events table, closing the spool-drain-path coverage gap the
  // reviewer flagged: no prior test exercised this path or would have caught
  // the malformed-shape defect.
  const dir = "/tmp/idisu-session-start-hook-test";
  rmSync(dir, { recursive: true, force: true });
  const idisuHome = join(dir, "idisu-home");
  mkdirSync(idisuHome, { recursive: true });

  const hookPayload = JSON.stringify({
    session_id: "sess-hook-e2e-001",
    cwd: "/home/user/my-project",
    model: "claude-sonnet-4-6",
    source: "startup",
    transcript_path: "/home/user/.claude/projects/my-project/sess-hook-e2e-001.jsonl",
  });

  const result = spawnSync("bash", [SESSION_START_HOOK], {
    input: hookPayload,
    env: { ...process.env, IDISU_HOME: idisuHome },
    encoding: "utf8",
  });
  expect(result.status).toBe(0);

  const dbPath = join(dir, "idisu.db");
  const db = openDb(dbPath);

  // Same sequence as gather(): drain the spool, validate each line against
  // EventEnvelopeSchema, insert the ones that pass.
  const spooled = drainSpool(join(idisuHome, "spool"));
  expect(spooled.length).toBe(1);

  let spooledEvents = 0;
  for (const raw of spooled) {
    const parsed = EventEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(true); // this is the exact assertion that used to fail
    if (!parsed.success) continue;
    insertEvent(db, {
      event_id: parsed.data.event_id,
      schema_version: parsed.data.schema_version,
      source_id: parsed.data.source_id,
      source_position: parsed.data.source_position,
      observed_at: parsed.data.observed_at,
      ingested_at: parsed.data.ingested_at,
      harness: parsed.data.harness,
      event_type: parsed.data.event_type,
      payload_version: parsed.data.payload_version,
      payload: parsed.data.payload,
    });
    spooledEvents++;
  }
  expect(spooledEvents).toBe(1);
  expect(countEvents(db)).toBe(1);

  const row = db
    .query("SELECT * FROM events WHERE event_type = 'session.observed'")
    .get() as
    | {
        event_id: string;
        source_id: string;
        harness: string;
        event_type: string;
        payload: string;
      }
    | undefined;
  expect(row).toBeDefined();
  expect(row!.source_id).toBe("cc-hook:sess-hook-e2e-001");
  expect(row!.harness).toBe("claude_code");

  const payload = JSON.parse(row!.payload) as {
    session_id: string;
    model?: string;
    workspace?: string;
    transcript_pointer: string;
  };
  expect(payload.session_id).toBe("sess-hook-e2e-001");
  expect(payload.model).toBe("claude-sonnet-4-6");
  expect(payload.workspace).toBe("/home/user/my-project");
  expect(payload.transcript_pointer).toBe(
    "/home/user/.claude/projects/my-project/sess-hook-e2e-001.jsonl",
  );

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
