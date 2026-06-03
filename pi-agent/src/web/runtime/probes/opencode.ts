import type { ProviderRateLimits } from "../quota-probe.ts";
import { windowTotals, DEFAULT_QUOTA_PATH } from "../../../runtime/usage-reader.ts";

export async function opencodeProbe(opts: {
  quotasPath?: string;
  monthlyLimitUsd?: number | null;
}): Promise<ProviderRateLimits> {
  const now = Date.now();
  const path = opts.quotasPath ?? DEFAULT_QUOTA_PATH;
  const w30d = windowTotals(path, 30 * 24 * 3600_000);
  const totals = w30d.opencode;
  const localCost = totals?.costUsd ?? 0;
  const limit = opts.monthlyLimitUsd ?? null;
  return {
    provider: "opencode", plan: null, account: null,
    windows: limit !== null ? [{
      label: "30d", used: localCost, limit,
      percentUsed: limit > 0 ? Math.round((localCost / limit) * 100) : 0,
      resetAt: null,
    }] : [],
    apiCostTotal: localCost, credits: null, probedAt: now,
    note: "Local cost estimate (no remote probe)", error: null,
  };
}
