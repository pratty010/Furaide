import type { ProviderRateLimits } from "../quota-probe.ts";
import { windowTotals, DEFAULT_QUOTA_PATH } from "../../../runtime/usage-reader.ts";

export async function googleVertexProbe(opts: {
  quotasPath?: string;
  combinedBudgetUsd?: number | null;
}): Promise<ProviderRateLimits> {
  const now = Date.now();
  const path = opts.quotasPath ?? DEFAULT_QUOTA_PATH;
  const w30d = windowTotals(path, 30 * 24 * 3600_000);
  const totals = w30d["google-vertex"];
  const localCost = totals?.costUsd ?? 0;
  const limit = opts.combinedBudgetUsd ?? null;
  return {
    provider: "google-vertex", plan: null, account: null,
    windows: limit !== null ? [{
      label: "30d", used: localCost, limit,
      percentUsed: limit > 0 ? Math.round((localCost / limit) * 100) : 0,
      resetAt: null,
    }] : [],
    apiCostTotal: localCost, credits: null, probedAt: now,
    note: "Local cost estimate (no Vertex quota API)", error: null,
  };
}
