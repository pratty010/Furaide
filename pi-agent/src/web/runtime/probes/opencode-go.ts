import type { ProviderRateLimits } from "../quota-probe.ts";
import { windowTotals, DEFAULT_QUOTA_PATH } from "../../../runtime/usage-reader.ts";

const TIMEOUT = 15_000;

async function scrapeOpenCodeGo(workspaceId: string, authCookie: string): Promise<{ usagePercent: number; resetInSec: number } | null> {
  try {
    const resp = await fetch(`https://opencode.ai/workspace/${workspaceId}/go`, {
      headers: {
        Cookie: `auth=${authCookie}`,
        "User-Agent": "pi-friday/1.0",
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const match =
      html.match(/__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/s) ??
      html.match(/window\.__nuxt__\s*=\s*({.+?})\s*<\/script>/s);
    if (!match) return null;

    const payload = JSON.parse(match[1]!);
    const str = JSON.stringify(payload);
    const pctMatch = str.match(/"usagePercent"\s*:\s*([0-9.]+)/);
    const resetMatch = str.match(/"resetInSec(onds)?"\s*:\s*([0-9]+)/);
    if (!pctMatch) return null;
    return {
      usagePercent: parseFloat(pctMatch[1]!),
      resetInSec: resetMatch ? parseInt(resetMatch[2]!) : 0,
    };
  } catch {
    return null;
  }
}

export async function openCodeGoProbe(opts: {
  workspaceId: string | null;
  authCookie: string | null;
  quotasPath?: string;
  monthlyLimitUsd?: number | null;
}): Promise<ProviderRateLimits> {
  const now = Date.now();
  const base: ProviderRateLimits = {
    provider: "opencode-go", plan: null, account: opts.workspaceId,
    windows: [], apiCostTotal: null, credits: null, probedAt: now, note: null, error: null,
  };

  if (opts.workspaceId && opts.authCookie) {
    const scraped = await scrapeOpenCodeGo(opts.workspaceId, opts.authCookie);
    if (scraped) {
      return {
        ...base,
        windows: [{
          label: "monthly",
          used: scraped.usagePercent,
          limit: 100,
          percentUsed: Math.round(scraped.usagePercent),
          resetAt: scraped.resetInSec > 0 ? now + scraped.resetInSec * 1000 : null,
        }],
        note: "HTML scrape: usage % from opencode.ai dashboard",
        error: null,
      };
    }
  }

  const quotasPath = opts.quotasPath ?? DEFAULT_QUOTA_PATH;
  const w30d = windowTotals(quotasPath, 30 * 24 * 3600_000);
  const totals = w30d["opencode-go"];
  const localCost = totals?.costUsd ?? 0;
  const limit = opts.monthlyLimitUsd ?? null;

  return {
    ...base,
    apiCostTotal: localCost,
    windows: limit !== null ? [{
      label: "30d-local",
      used: localCost,
      limit,
      percentUsed: limit > 0 ? Math.round((localCost / limit) * 100) : 0,
      resetAt: null,
    }] : [],
    note: opts.workspaceId ? "Scrape failed — local fallback cost" : "No credentials — local cost estimate",
    error: null,
  };
}
