import type { ProviderRateLimits } from "../quota-probe.ts";
import { windowTotals, DEFAULT_QUOTA_PATH } from "../../../runtime/usage-reader.ts";

export async function vercelAiGatewayProbe(opts: {
  quotasPath?: string;
}): Promise<ProviderRateLimits> {
  const now = Date.now();
  const path = opts.quotasPath ?? DEFAULT_QUOTA_PATH;
  const w30d = windowTotals(path, 30 * 24 * 3600_000);
  const localCost = w30d["vercel-ai-gateway"]?.costUsd ?? 0;
  return {
    provider: "vercel-ai-gateway", plan: null, account: null,
    windows: [],
    apiCostTotal: localCost, credits: null, probedAt: now,
    note: "Local cost estimate (no remote probe)", error: null,
  };
}
