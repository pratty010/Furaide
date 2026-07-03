import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";

const currentMonth = `${new Date().toISOString().slice(0, 7)}`;

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    create table provider_usage (
      provider text not null,
      month text not null,
      calls integer not null default 0,
      units_used real not null default 0,
      estimated_cost_usd real not null default 0,
      tokens_input integer not null default 0,
      tokens_output integer not null default 0,
      warning_80_shown integer not null default 0,
      warning_90_shown integer not null default 0,
      budget_exceeded_shown integer not null default 0,
      suppressed integer not null default 0,
      last_call_at text,
      primary key (provider, month)
    )
  `);
  return db;
}

describe("checkBudget one-shot warning preambles", () => {
  function makeSnapshot(overrides = {}) {
    return {
      provider: "gemini",
      month: "2026-06",
      calls: 10,
      units_used: 10,
      estimated_cost_usd: 0,
      tokens_input: 0,
      tokens_output: 0,
      warning_80_shown: 0,
      warning_90_shown: 0,
      budget_exceeded_shown: 0,
      suppressed: 0,
      last_call_at: null,
      ...overrides,
    };
  }
  const budgets = { geminiUsd: 5.0, braveRequests: 2000, tavilyCredits: 1000 };

  test("warn80 preamble suppressed once shown", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const first = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.0 }), "gemini");
    expect(first.warningLevel).toBe("warn80");
    expect(first.preamble).toContain("80%");

    const second = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.0, warning_80_shown: 1 }), "gemini");
    expect(second.warningLevel).toBe("warn80");
    expect(second.preamble).toBeNull();
  });

  test("warn90 preamble suppressed once shown", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const first = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.5 }), "gemini");
    expect(first.preamble).toContain("90%");

    const second = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.5, warning_90_shown: 1 }), "gemini");
    expect(second.warningLevel).toBe("warn90");
    expect(second.preamble).toBeNull();
  });

  test("exceeded preamble suppressed once shown, block remains", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const first = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 5.0 }), "gemini");
    expect(first.blocked).toBe(true);
    expect(first.preamble).toContain("Budget exceeded");

    const second = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 5.0, budget_exceeded_shown: 1 }), "gemini");
    expect(second.blocked).toBe(true);
    expect(second.warningLevel).toBe("exceeded");
    expect(second.preamble).toBeNull();
  });

  test("brave exceeded preamble suppressed once shown", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const first = checkBudget(budgets, makeSnapshot({ provider: "brave", units_used: 1900 }), "brave");
    expect(first.blocked).toBe(true);

    const second = checkBudget(budgets, makeSnapshot({ provider: "brave", units_used: 1900, budget_exceeded_shown: 1 }), "brave");
    expect(second.blocked).toBe(true);
    expect(second.preamble).toBeNull();
  });

  test("warning still emitted when not yet shown", async () => {
    const { checkBudget } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const result = checkBudget(budgets, makeSnapshot({ estimated_cost_usd: 4.0, warning_80_shown: 0 }), "gemini");
    expect(result.preamble).toContain("80%");
  });
});

describe("checkAndRecord atomic budget + one-shot preamble", () => {
  const budgets = { geminiUsd: 5.0, braveRequests: 2000, tavilyCredits: 1000 };

  test("repeated calls after threshold only emit preamble once", async () => {
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const db = freshDb();
    db.prepare(`
      insert into provider_usage (provider, month, calls, units_used, estimated_cost_usd, tokens_input, tokens_output, suppressed, last_call_at)
      values ('gemini', '${currentMonth}', 5, 5, 3.9, 0, 0, 0, datetime('now'))
    `).run();
    const usage = createUsageTracker(db, budgets);

    const r1 = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.2,
    });
    expect(r1.budget.warningLevel).toBe("warn80");
    expect(r1.budget.preamble).toContain("80%");
    expect(r1.snapshot.warning_80_shown).toBe(1);

    const r2 = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.05,
    });
    expect(r2.budget.warningLevel).toBe("warn80");
    expect(r2.budget.preamble).toBeNull();
  });

  test("escalation from warn80 to warn90 emits a new preamble", async () => {
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const db = freshDb();
    db.prepare(`
      insert into provider_usage (provider, month, calls, units_used, estimated_cost_usd, tokens_input, tokens_output, suppressed, last_call_at)
      values ('gemini', '${currentMonth}', 5, 5, 3.9, 0, 0, 0, datetime('now'))
    `).run();
    const usage = createUsageTracker(db, budgets);

    const r1 = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.2,
    });
    expect(r1.budget.warningLevel).toBe("warn80");
    expect(r1.budget.preamble).toContain("80%");

    const r2 = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.4,
    });
    expect(r2.budget.warningLevel).toBe("warn90");
    expect(r2.budget.preamble).toContain("90%");
  });

  test("does not block when budget not exceeded", async () => {
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const db = freshDb();
    const usage = createUsageTracker(db, budgets);
    const r = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.01,
    });
    expect(r.budget.blocked).toBe(false);
    expect(r.budget.warningLevel).toBe("none");
    expect(r.budget.preamble).toBeNull();
  });

  test("blocks and emits exceeded preamble at threshold", async () => {
    const { createUsageTracker } = await import("../../plugins/tools/web-tools/provider-usage.ts");
    const db = freshDb();
    db.prepare(`
      insert into provider_usage (provider, month, calls, units_used, estimated_cost_usd, tokens_input, tokens_output, suppressed, last_call_at)
      values ('gemini', '${currentMonth}', 5, 5, 5.0, 0, 0, 0, datetime('now'))
    `).run();
    const usage = createUsageTracker(db, budgets);
    const r = await usage.checkAndRecord({
      provider: "gemini",
      unitsUsed: 1,
      estimatedCostUsd: 0.0,
    });
    expect(r.budget.blocked).toBe(true);
    expect(r.budget.warningLevel).toBe("exceeded");
    expect(r.budget.preamble).toContain("Budget exceeded");
    expect(r.snapshot.budget_exceeded_shown).toBe(1);
  });
});
