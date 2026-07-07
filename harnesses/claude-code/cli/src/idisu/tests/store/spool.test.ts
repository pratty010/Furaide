import { test, expect } from "bun:test";
import { appendSpool, drainSpool } from "../../src/store/spool.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("append then drain returns each event once, empties spool", () => {
  const dir = mkdtempSync(join(tmpdir(), "idisu-spool-"));
  appendSpool(dir, { event_id: "a", kind: "session.start" });
  appendSpool(dir, { event_id: "b", kind: "skill.used" });
  const first = drainSpool(dir);
  expect(first.map((e:any)=>e.event_id)).toEqual(["a","b"]);
  const second = drainSpool(dir);
  expect(second).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});
