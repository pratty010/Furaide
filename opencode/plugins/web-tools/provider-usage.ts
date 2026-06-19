import { Database } from "bun:sqlite";
import type { UsageRecord, UsageSnapshot, WebProvider } from "./types.ts";

export interface UsageTracker {
  record(opts: UsageRecord): Promise<void>;
  getMonth(provider: WebProvider, month: string): Promise<UsageSnapshot>;
  recordFromSearch(metadata: { provider: string; unitsUsed?: number; tokensInput?: number; tokensOutput?: number }): Promise<void>;
  recordFromFetch(metadata: { provider: string; unitsUsed?: number; tokensInput?: number; tokensOutput?: number }): Promise<void>;
}

export function createUsageTracker(db: Database): UsageTracker {
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

  async function record(opts: UsageRecord): Promise<void> {
    insertStmt.run(opts.provider, opts.month, opts.unitsUsed, opts.estimatedCostUsd, opts.tokensInput ?? 0, opts.tokensOutput ?? 0);
  }

  async function getMonth(provider: WebProvider, month: string): Promise<UsageSnapshot> {
    const row = selectStmt.get(provider, month) as UsageSnapshot | undefined;
    if (row) return row;
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

  async function recordFromSearch(metadata: { provider: string; unitsUsed?: number; tokensInput?: number; tokensOutput?: number }): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    return record({
      provider: metadata.provider as WebProvider,
      unitsUsed: metadata.unitsUsed ?? 1,
      estimatedCostUsd: 0,
      month,
      tokensInput: metadata.tokensInput,
      tokensOutput: metadata.tokensOutput,
    });
  }

  async function recordFromFetch(metadata: { provider: string; unitsUsed?: number; tokensInput?: number; tokensOutput?: number }): Promise<void> {
    return recordFromSearch(metadata);
  }

  return { record, getMonth, recordFromSearch, recordFromFetch };
}
