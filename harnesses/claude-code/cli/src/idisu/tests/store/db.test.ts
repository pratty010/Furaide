import { test, expect } from "bun:test";
import { openDb } from "../../src/store/db.js";
import { rmSync } from "node:fs";

test("openDb creates all core tables + sets user_version", () => {
  const p = "/tmp/idisu-db-test.sqlite";
  rmSync(p, { force: true });
  const db = openDb(p);
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
  for (const t of ["events","sessions","artifacts","evidence_ledger","outcome_labels","workflow_ngrams","nodes","edges","checkpoints","metric_rollups","rejected_signatures"])
    expect(tables).toContain(t);
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
  db.close();
});
