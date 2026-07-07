import { test, expect } from "bun:test";
import { openDb } from "../../src/store/db.js";
import { insertEvent, countEvents } from "../../src/store/repo.js";
import { rmSync } from "node:fs";

test("insertEvent is idempotent on event_id", () => {
  const p = "/tmp/idisu-repo-test.sqlite"; rmSync(p, { force: true });
  const db = openDb(p);
  const ev = { event_id: "x", schema_version: 1, source_id: "s", source_position: 0,
    observed_at: "t", ingested_at: "t", harness: "claude_code", event_type: "session.observed",
    payload_version: 1, payload: {} };
  insertEvent(db, ev); insertEvent(db, ev);
  expect(countEvents(db)).toBe(1);
  db.close();
});
