import { existsSync, readFileSync } from "node:fs";
import type { UsageEntry, QuotasFile } from "./usage-recorder.ts";

export interface ProviderTotals {
  messages: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  byModel: Record<string, { messages: number; costUsd: number }>;
}

export const DEFAULT_QUOTA_PATH = `${process.env.HOME ?? ""}/.pi/agent/extensions/friday/state/quotas.json`;

function loadFile(path: string): QuotasFile {
  if (!existsSync(path)) return { version: 1, byProvider: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw?.version !== 1 || !raw.byProvider || typeof raw.byProvider !== "object" || Array.isArray(raw.byProvider)) return { version: 1, byProvider: {} };
    return raw as QuotasFile;
  } catch {
    return { version: 1, byProvider: {} };
  }
}

function aggregate(entries: UsageEntry[]): ProviderTotals {
  const totals: ProviderTotals = {
    messages: 0, costUsd: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, byModel: {},
  };
  for (const e of entries) {
    totals.messages++;
    totals.costUsd += e.costUsd ?? 0;
    totals.inputTokens += e.inputTokens ?? 0;
    totals.outputTokens += e.outputTokens ?? 0;
    totals.cacheReadTokens += e.cacheReadTokens ?? 0;
    totals.cacheWriteTokens += e.cacheWriteTokens ?? 0;
    const m = e.model || "unknown";
    if (!totals.byModel[m]) totals.byModel[m] = { messages: 0, costUsd: 0 };
    totals.byModel[m]!.messages++;
    totals.byModel[m]!.costUsd += e.costUsd ?? 0;
  }
  return totals;
}

export function sessionTotals(path: string, sessionId: string): Record<string, ProviderTotals> {
  const file = loadFile(path);
  const result: Record<string, ProviderTotals> = {};
  for (const [provider, entries] of Object.entries(file.byProvider)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((e) => e.sessionId === sessionId);
    if (filtered.length > 0) result[provider] = aggregate(filtered);
  }
  return result;
}

export function windowTotals(path: string, windowMs: number): Record<string, ProviderTotals> {
  const file = loadFile(path);
  const cutoff = Date.now() - windowMs;
  const result: Record<string, ProviderTotals> = {};
  for (const [provider, entries] of Object.entries(file.byProvider)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((e) => e.at >= cutoff);
    if (filtered.length > 0) result[provider] = aggregate(filtered);
  }
  return result;
}
