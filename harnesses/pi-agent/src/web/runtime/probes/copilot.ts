import type { ProviderRateLimits, ProviderRateLimitWindow } from "../quota-probe.ts";

const TIMEOUT = 15_000;

export async function copilotProbe(opts: { token: string | null }): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "github-copilot", plan: null, account: null, windows: [],
    apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };
  if (!opts.token) return { ...base, error: "no copilot auth" };

  try {
    const resp = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        Authorization: `token ${opts.token}`,
        "User-Agent": "pi-friday/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return { ...base, error: `HTTP ${resp.status}` };
    const data = await resp.json() as Record<string, unknown>;

    const quotaData = (data.copilot_chat ?? data) as Record<string, unknown>;
    const monthly = quotaData.monthly_quota_requests ?? quotaData.quota;
    const used = quotaData.monthly_used_requests ?? quotaData.used;
    const resetDate = quotaData.quota_reset_date as string | undefined;
    const plan = (data.plan ?? (data.copilot_plan as Record<string, unknown>)?.type ?? null) as string | null;

    const windows: ProviderRateLimitWindow[] = [];
    if (typeof monthly === "number" && typeof used === "number") {
      windows.push({
        label: "monthly",
        used,
        limit: monthly,
        percentUsed: monthly > 0 ? Math.round((used / monthly) * 100) : 0,
        resetAt: resetDate ? new Date(resetDate).getTime() : null,
      });
    }

    const login = (data.login as string) ?? null;
    return { ...base, plan, account: login, windows, error: null };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}