import { test, expect } from "bun:test";

test("provider usage rolls up by provider and month", async () => {
  const { openTestDb } = await import("../../plugins/web-tools/db.ts");
  const { createUsageTracker } = await import("../../plugins/web-tools/provider-usage.ts");

  const db = openTestDb();
  const usage = createUsageTracker(db);
  await usage.record({ provider: "brave", unitsUsed: 1, estimatedCostUsd: 0, month: "2026-06" });
  const snapshot = await usage.getMonth("brave", "2026-06");
  expect(snapshot.calls).toBe(1);
  expect(snapshot.units_used).toBe(1);
});
