import type { ProviderRateLimits, ProviderRateLimitWindow } from "../quota-probe.ts";

const TIMEOUT = 15_000;

export async function zaiProbe(opts: { token: string | null }): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "zai", plan: null, account: null, windows: [],
    apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };
  if (!opts.token) return { ...base, error: "no zai auth" };

  try {
    const resp = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return { ...base, error: `HTTP ${resp.status}` };
    const data = await resp.json() as Record<string, unknown>;

    const windows: ProviderRateLimitWindow[] = [];
    const items = (data.data ?? data.quotas ?? data.limits ?? []) as Array<Record<string, unknown>>;
    for (const item of items) {
      const label = (item.type ?? item.label ?? item.quota_type) as string | undefined;
      const limit = item.limit ?? item.quota_limit;
      const used = item.used ?? item.usage ?? 0;
      if (!label || typeof limit !== "number") continue;
      windows.push({
        label: String(label),
        used: used as number,
        limit,
        percentUsed: limit > 0 ? Math.round(((used as number) / limit) * 100) : 0,
        resetAt: typeof item.reset_at === "number" ? item.reset_at * 1000 : null,
      });
    }
    return { ...base, windows, error: null };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}