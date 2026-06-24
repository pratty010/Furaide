import type { ProviderRateLimits, ProviderRateLimitWindow } from "../quota-probe.ts";

const TIMEOUT = 15_000;

export async function kimiProbe(opts: { token: string | null }): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "kimi-coding", plan: null, account: null, windows: [],
    apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };
  if (!opts.token) return { ...base, error: "no kimi auth" };

  try {
    const resp = await fetch("https://api.kimi.com/coding/v1/usages", {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return { ...base, error: `HTTP ${resp.status}` };
    const data = await resp.json() as Record<string, unknown>;

    const windows: ProviderRateLimitWindow[] = [];
    const usages = (data.usages ?? data.quotas ?? []) as Array<Record<string, unknown>>;
    for (const u of usages) {
      if (!u.label || typeof u.limit !== "number") continue;
      const used = (u.used ?? 0) as number;
      windows.push({
        label: String(u.label),
        used,
        limit: u.limit,
        percentUsed: u.limit > 0 ? Math.round((used / u.limit) * 100) : 0,
        resetAt: typeof u.reset_at === "number" ? u.reset_at * 1000 : null,
      });
    }
    return { ...base, windows, error: null };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}