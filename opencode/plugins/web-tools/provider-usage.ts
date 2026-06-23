import { Database } from "bun:sqlite";
import type { UsageRecord, UsageSnapshot, WebProvider, BudgetConfig, UsageMetadata } from "./types.ts";

export interface BudgetCheckResult {
  blocked: boolean;
  warningLevel: "none" | "warn80" | "warn90" | "exceeded";
  preamble: string | null;
}

export interface UsageTracker {
  record(opts: UsageRecord): Promise<void>;
  getMonth(provider: WebProvider, month: string): Promise<UsageSnapshot>;
  recordFromSearch(metadata: UsageMetadata): Promise<void>;
  recordFromFetch(metadata: UsageMetadata): Promise<void>;
  checkAndRecord(opts: { provider: WebProvider; unitsUsed?: number; tokensInput?: number; tokensOutput?: number; estimatedCostUsd?: number }): Promise<{ snapshot: UsageSnapshot; budget: BudgetCheckResult }>;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function providerLimitKey(provider: WebProvider): keyof BudgetConfig {
  if (provider === "gemini") return "geminiUsd";
  if (provider === "brave") return "braveRequests";
  return "tavilyCredits";
}

function getUsage(budgets: BudgetConfig, snapshot: UsageSnapshot, provider: WebProvider): { used: number; limit: number } {
  if (provider === "gemini") return { used: snapshot.estimated_cost_usd, limit: budgets.geminiUsd };
  if (provider === "brave") return { used: snapshot.units_used, limit: budgets.braveRequests };
  return { used: snapshot.units_used, limit: budgets.tavilyCredits };
}

function newSnapshot(provider: WebProvider, month: string): UsageSnapshot {
  return {
    provider,
    month,
    calls: 0,
    units_used: 0,
    estimated_cost_usd: 0,
    tokens_input: 0,
    tokens_output: 0,
    warning_80_shown: 0,
    warning_90_shown: 0,
    budget_exceeded_shown: 0,
    suppressed: 0,
    last_call_at: null,
  };
}

function classifyGemini(used: number, limit: number): BudgetCheckResult {
  if (used >= limit) {
    return { blocked: true, warningLevel: "exceeded", preamble: `[Budget exceeded] gemini: $${used.toFixed(2)} used of $${limit.toFixed(2)} monthly limit reached. Tool calls blocked until reset.` };
  }
  if (used >= limit * 0.9) {
    return { blocked: false, warningLevel: "warn90", preamble: `[Budget warning] gemini: $${used.toFixed(2)} used of $${limit.toFixed(2)} (90%+). Calls will be blocked at $${limit.toFixed(2)}.` };
  }
  if (used >= limit * 0.8) {
    return { blocked: false, warningLevel: "warn80", preamble: `[Budget warning] gemini: $${used.toFixed(2)} used of $${limit.toFixed(2)} (80%+).` };
  }
  return { blocked: false, warningLevel: "none", preamble: null };
}

function classifyUnits(used: number, limit: number, provider: WebProvider): BudgetCheckResult {
  if (used >= limit * 0.9) {
    return { blocked: true, warningLevel: "exceeded", preamble: `[Budget exceeded] ${provider}: ${used} of ${limit} units used. Tool calls blocked until reset.` };
  }
  if (used >= limit * 0.8) {
    return { blocked: false, warningLevel: "warn80", preamble: `[Budget warning] ${provider}: ${used} of ${limit} units used (80%+).` };
  }
  return { blocked: false, warningLevel: "none", preamble: null };
}

export function checkBudget(budgets: BudgetConfig | null, snapshot: UsageSnapshot, provider: WebProvider): BudgetCheckResult {
  if (!budgets) return { blocked: false, warningLevel: "none", preamble: null };
  if (snapshot.suppressed > 0) return { blocked: false, warningLevel: "none", preamble: null };

  const { used, limit } = getUsage(budgets, snapshot, provider);
  if (limit <= 0) return { blocked: false, warningLevel: "none", preamble: null };

  const result = provider === "gemini"
    ? classifyGemini(used, limit)
    : classifyUnits(used, limit, provider);

  if (result.warningLevel === "none" || result.preamble === null) return result;

  if (result.warningLevel === "warn80" && snapshot.warning_80_shown === 1) {
    return { blocked: false, warningLevel: "warn80", preamble: null };
  }
  if (result.warningLevel === "warn90" && snapshot.warning_90_shown === 1) {
    return { blocked: false, warningLevel: "warn90", preamble: null };
  }
  if (result.warningLevel === "exceeded" && snapshot.budget_exceeded_shown === 1) {
    return { blocked: result.blocked, warningLevel: "exceeded", preamble: null };
  }

  return result;
}

function updateWarningFlags(
  db: Database,
  provider: WebProvider,
  month: string,
  level: "none" | "warn80" | "warn90" | "exceeded",
  current: UsageSnapshot,
): void {
  let w80 = current.warning_80_shown;
  let w90 = current.warning_90_shown;
  let exceeded = current.budget_exceeded_shown;

  if (level === "warn80" || level === "warn90" || level === "exceeded") w80 = 1;
  if (level === "warn90" || level === "exceeded") w90 = 1;
  if (level === "exceeded") exceeded = 1;

  if (w80 === current.warning_80_shown && w90 === current.warning_90_shown && exceeded === current.budget_exceeded_shown) {
    return;
  }

  db.prepare(`
    update provider_usage set
      warning_80_shown = ?1,
      warning_90_shown = ?2,
      budget_exceeded_shown = ?3
    where provider = ?4 and month = ?5
  `).run(w80, w90, exceeded, provider, month);
}

export function createUsageTracker(db: Database, budgets?: BudgetConfig): UsageTracker {
  const insertStmt = db.prepare(`
    insert into provider_usage (provider, month, calls, units_used, estimated_cost_usd, tokens_input, tokens_output, suppressed, last_call_at)
    values (?1, ?2, 1, ?3, ?4, ?5, ?6, 0, datetime('now'))
    on conflict (provider, month) do update set
      calls = calls + 1,
      units_used = units_used + excluded.units_used,
      estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd,
      tokens_input = tokens_input + excluded.tokens_input,
      tokens_output = tokens_output + excluded.tokens_output,
      last_call_at = datetime('now')
  `);

  const selectStmt = db.prepare(`
    select
      provider,
      month,
      calls,
      units_used,
      estimated_cost_usd,
      tokens_input,
      tokens_output,
      warning_80_shown,
      warning_90_shown,
      budget_exceeded_shown,
      suppressed,
      last_call_at
    from provider_usage
    where provider = ?1 and month = ?2
  `);

  const seedRow = db.prepare(`
    insert into provider_usage (provider, month, calls, units_used, estimated_cost_usd, tokens_input, tokens_output, suppressed, last_call_at)
    values (?1, ?2, 0, 0, 0, 0, 0, 0, null)
    on conflict (provider, month) do nothing
  `);

  const tx = db.transaction((opts: {
    provider: WebProvider;
    month: string;
    unitsUsed: number;
    estimatedCostUsd: number;
    tokensInput: number;
    tokensOutput: number;
  }): UsageSnapshot => {
    seedRow.run(opts.provider, opts.month);
    insertStmt.run(opts.provider, opts.month, opts.unitsUsed, opts.estimatedCostUsd, opts.tokensInput, opts.tokensOutput);
    return selectStmt.get(opts.provider, opts.month) as UsageSnapshot;
  });

  async function record(opts: UsageRecord): Promise<void> {
    const month = opts.month;
    tx({
      provider: opts.provider,
      month,
      unitsUsed: opts.unitsUsed,
      estimatedCostUsd: opts.estimatedCostUsd,
      tokensInput: opts.tokensInput ?? 0,
      tokensOutput: opts.tokensOutput ?? 0,
    });
  }

  async function getMonth(provider: WebProvider, month: string): Promise<UsageSnapshot> {
    const row = selectStmt.get(provider, month) as UsageSnapshot | undefined;
    return row ?? newSnapshot(provider, month);
  }

  async function recordFromSearch(metadata: UsageMetadata): Promise<void> {
    return record({
      provider: metadata.provider as WebProvider,
      unitsUsed: metadata.unitsUsed ?? 1,
      estimatedCostUsd: metadata.estimatedCostUsd ?? 0,
      month: currentMonth(),
      tokensInput: metadata.tokensInput,
      tokensOutput: metadata.tokensOutput,
    });
  }

  async function recordFromFetch(metadata: UsageMetadata): Promise<void> {
    return recordFromSearch(metadata);
  }

  async function checkAndRecord(opts: { provider: WebProvider; unitsUsed?: number; tokensInput?: number; tokensOutput?: number; estimatedCostUsd?: number }): Promise<{ snapshot: UsageSnapshot; budget: BudgetCheckResult }> {
    const month = currentMonth();
    const before = await getMonth(opts.provider, month);
    const preCheck = checkBudget(budgets ?? null, before, opts.provider);

    if (preCheck.blocked) {
      updateWarningFlags(db, opts.provider, month, preCheck.warningLevel, before);
      const updated = await getMonth(opts.provider, month);
      return { snapshot: updated, budget: preCheck };
    }

    const newSnapshot = tx({
      provider: opts.provider,
      month,
      unitsUsed: opts.unitsUsed ?? 1,
      estimatedCostUsd: opts.estimatedCostUsd ?? 0,
      tokensInput: opts.tokensInput ?? 0,
      tokensOutput: opts.tokensOutput ?? 0,
    });

    const postCheck = checkBudget(budgets ?? null, newSnapshot, opts.provider);
    if (postCheck.warningLevel !== "none") {
      updateWarningFlags(db, opts.provider, month, postCheck.warningLevel, newSnapshot);
      const final = await getMonth(opts.provider, month);
      return { snapshot: final, budget: postCheck };
    }

    return { snapshot: newSnapshot, budget: postCheck };
  }

  return { record, getMonth, recordFromSearch, recordFromFetch, checkAndRecord };
}
