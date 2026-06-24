import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ProviderRateLimitWindow {
  label: string;
  used: number;
  limit: number | null;
  percentUsed: number;
  resetAt: number | null;
}

export interface ProviderRateLimits {
  provider: string;
  plan: string | null;
  account: string | null;
  windows: ProviderRateLimitWindow[];
  apiCostTotal: number | null;
  credits: number | null;
  probedAt: number;
  note: string | null;
  error: string | null;
}

export function loadQuotaSnapshot(path: string): Record<string, ProviderRateLimits> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object" || !raw.providers) return {};
    return raw.providers as Record<string, ProviderRateLimits>;
  } catch { return {}; }
}

export function saveQuotaSnapshot(path: string, providers: Record<string, ProviderRateLimits>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, providers }, null, 2), "utf8");
  } catch {}
}

export function shouldPreserveStaleWindows(prev: ProviderRateLimits | undefined, fresh: ProviderRateLimits): boolean {
  if (!prev) return false;
  if (prev.windows.length === 0) return false;
  return fresh.windows.length === 0;
}
