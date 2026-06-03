import type { ProviderRateLimits } from "../quota-probe.ts";

const TIMEOUT = 15_000;
const CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

export async function googleProbe(opts: {
  token: string | null;
  projectId?: string | null;
}): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "google", plan: null, account: null, windows: [],
    apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };
  if (!opts.token) return { ...base, error: "no google auth" };

  try {
    let email: string | null = null;
    try {
      const userResp = await fetch("https://www.googleapis.com/oauth2/v1/userinfo", {
        headers: { Authorization: `Bearer ${opts.token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (userResp.ok) {
        const userInfo = await userResp.json() as Record<string, unknown>;
        email = (userInfo.email as string) ?? null;
      }
    } catch {}

    const body: Record<string, unknown> = { pluginType: "CLOUD_CODE", platform: "IDE" };
    if (opts.projectId) body.cloudaicompanionProject = opts.projectId;

    const resp = await fetch(CODE_ASSIST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return { ...base, account: email, error: `HTTP ${resp.status}` };
    const data = await resp.json() as Record<string, unknown>;

    const currentTier = (data.currentTier ?? data.tier ?? null) as string | null;
    const allowedTier = (data.allowedTier ?? null) as string | null;
    const plan = currentTier ?? allowedTier;

    return { ...base, plan, account: email, note: "Google Code Assist: plan info only", error: null };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
