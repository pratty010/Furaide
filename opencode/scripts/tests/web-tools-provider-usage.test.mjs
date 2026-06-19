import { test, expect, describe } from "bun:test";

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

describe("checkBudget exceeded levels", () => {
  async function makeSnapshot(units_used, suppressed = 0) {
    return {
      provider: "brave", month: "2026-06", calls: 0,
      units_used, estimated_cost_usd: 0,
      tokens_input: 0, tokens_output: 0,
      warning_80_shown: 0, warning_90_shown: 0, budget_exceeded_shown: 0,
      suppressed, last_call_at: null,
    };
  }

  test("Brave at >=100% returns blocked exceeded, not warn90", async () => {
    const { checkBudget } = await import("../../plugins/web-tools/provider-usage.ts");
    const budgets = { geminiUsd: 5, braveRequests: 100, tavilyCredits: 100 };

    const result = checkBudget(budgets, await makeSnapshot(100), "brave");
    expect(result.blocked).toBe(true);
    expect(result.warningLevel).toBe("exceeded");
    expect(result.preamble).toContain("Budget exceeded");
  });

  test("Tavily at >=100% returns blocked exceeded, not warn90", async () => {
    const { checkBudget } = await import("../../plugins/web-tools/provider-usage.ts");
    const budgets = { geminiUsd: 5, braveRequests: 100, tavilyCredits: 100 };

    const result = checkBudget(budgets, await makeSnapshot(100), "tavily");
    expect(result.blocked).toBe(true);
    expect(result.warningLevel).toBe("exceeded");
  });

  test("Brave at 95% returns warn90, not exceeded", async () => {
    const { checkBudget } = await import("../../plugins/web-tools/provider-usage.ts");
    const budgets = { geminiUsd: 5, braveRequests: 100, tavilyCredits: 100 };

    const result = checkBudget(budgets, await makeSnapshot(95), "brave");
    expect(result.blocked).toBe(false);
    expect(result.warningLevel).toBe("warn90");
  });

  test("Gemini at >=100% returns blocked exceeded", async () => {
    const { checkBudget } = await import("../../plugins/web-tools/provider-usage.ts");
    const budgets = { geminiUsd: 5, braveRequests: 100, tavilyCredits: 100 };

    const result = checkBudget(budgets, await makeSnapshot(0, 0), "gemini");
    // Override snapshot for gemini cost-based budget
    const costSnapshot = await makeSnapshot(0);
    const geminiResult = checkBudget(budgets, {
      ...costSnapshot,
      estimated_cost_usd: 5,
    }, "gemini");
    expect(geminiResult.blocked).toBe(true);
    expect(geminiResult.warningLevel).toBe("exceeded");
  });
});
