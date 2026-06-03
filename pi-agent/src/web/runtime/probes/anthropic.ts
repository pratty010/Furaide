import type { ProviderRateLimits, ProviderRateLimitWindow } from "../quota-probe.ts";

const TIMEOUT = 15_000;

export async function anthropicProbe(opts: { token: string | null }): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "anthropic", plan: null, account: null, windows: [],
    apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };
  if (!opts.token) return { ...base, error: "no anthropic auth" };

  const isOAuth = opts.token.startsWith("sk-ant-oat");
  try {
    if (isOAuth) {
      const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${opts.token}` },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!resp.ok) return { ...base, error: `HTTP ${resp.status}` };
      const data = await resp.json() as Record<string, unknown>;
      const windows: ProviderRateLimitWindow[] = [];
      for (const [key, label] of [["quota_5h", "5h"], ["quota_7d", "7d"]] as const) {
        const q = data[key] as Record<string, number> | undefined;
        if (q?.limit) {
          windows.push({
            label,
            used: q.used ?? 0,
            limit: q.limit,
            percentUsed: Math.round(((q.used ?? 0) / q.limit) * 100),
            resetAt: q.reset_in_seconds ? now + q.reset_in_seconds * 1000 : null,
          });
        }
      }
      const account = (data.account as Record<string, string> | undefined)?.email ?? null;
      return { ...base, plan: (data.plan as string) ?? null, account, windows, error: null };
    } else {
      const resp = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": opts.token, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const windows: ProviderRateLimitWindow[] = [];
      const lim = resp.headers.get("anthropic-ratelimit-requests-limit");
      const rem = resp.headers.get("anthropic-ratelimit-requests-remaining");
      const reset = resp.headers.get("anthropic-ratelimit-requests-reset");
      if (lim && rem) {
        const limit = parseInt(lim), remaining = parseInt(rem);
        const used = limit - remaining;
        windows.push({
          label: "5h",
          used,
          limit,
          percentUsed: Math.round((used / limit) * 100),
          resetAt: reset ? new Date(reset).getTime() : null,
        });
      }
      return { ...base, windows, note: "API key: rate-limit headers only", error: null };
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
