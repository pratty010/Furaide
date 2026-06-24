import type { ProviderRateLimits, ProviderRateLimitWindow } from "../quota-probe.ts";

const TIMEOUT = 15_000;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const padded = parts[1]!.padEnd(parts[1]!.length + (4 - (parts[1]!.length % 4)) % 4, "=");
    return JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

export async function openaiProbe(opts: { token: string | null }): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "openai-codex", plan: null, account: null, windows: [],
    apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };
  if (!opts.token) return { ...base, error: "no openai auth" };

  const payload = decodeJwtPayload(opts.token);
  const email = (payload?.email as string) ?? null;

  try {
    const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return { ...base, account: email, error: `HTTP ${resp.status}` };
    const data = await resp.json() as Record<string, unknown>;

    const windows: ProviderRateLimitWindow[] = [];
    const quotas = (data.quotas ?? data.limits ?? []) as Array<Record<string, unknown>>;
    for (const q of quotas) {
      if (typeof q.limit !== "number" || !q.label) continue;
      const used = typeof q.used === "number" ? q.used : (typeof q.limit === "number" && typeof q.remaining === "number" ? q.limit - q.remaining : 0);
      windows.push({
        label: String(q.label),
        used,
        limit: q.limit,
        percentUsed: q.limit > 0 ? Math.round((used / q.limit) * 100) : 0,
        resetAt: typeof q.reset_at === "number" ? q.reset_at * 1000 : null,
      });
    }
    const plan = (data.plan ?? data.tier ?? null) as string | null;
    return { ...base, plan, account: email, windows, error: null };
  } catch (err) {
    return { ...base, account: email, error: err instanceof Error ? err.message : String(err) };
  }
}
