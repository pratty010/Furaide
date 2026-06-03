import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ToolQuotaEntry {
  used: number;
  lastReset: number | null;
  nextReset: number | null;
  lastUpdated: number;
}

interface ToolQuotasFile {
  version: 1;
  providers: Record<string, ToolQuotaEntry>;
}

export const DEFAULT_TOOL_QUOTAS_PATH =
  `${process.env.HOME ?? ""}/.pi/agent/extensions/friday/state/tool-quotas.json`;

/**
 * Compute the next reset timestamp as midnight (in the given timezone)
 * on the configured reset day. If the reset day has already passed this
 * month, the reset rolls to the following month.
 */
export function computeNextReset(
  resetDay: number,
  timezone: string,
  from = Date.now(),
): number {
  const now = new Date(from);
  const tzStr = now.toLocaleDateString("en-CA", { timeZone: timezone }); // "2026-04-15"
  const [yr, mo, dy] = tzStr.split("-").map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, "0");

  let year = yr, month = mo; // month is 1-based
  if (dy >= resetDay) {
    month++;
    if (month > 12) { month = 1; year++; }
  }

  // Build the local midnight string in the given timezone and convert to UTC ms
  const localMidnight = `${year}-${pad(month)}-${pad(resetDay)}T00:00:00`;
  const probe = new Date(localMidnight + "Z"); // treat as UTC first

  // Use Intl.DateTimeFormat to get the local time in the target timezone
  // at this UTC instant, then compute the offset cleanly.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(probe);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)!.value);

  const localTimeMs = Date.UTC(
    getPart("year"),
    getPart("month") - 1,
    getPart("day"),
    getPart("hour"),
    getPart("minute"),
    getPart("second"),
  );

  // The offset is the difference between the probe (localMidnight interpreted as UTC)
  // and the actual local time in the target timezone at that UTC instant.
  const offsetMs = probe.getTime() - localTimeMs;

  // Adjust the probe by the offset to get the UTC instant where local time is localMidnight.
  return probe.getTime() + offsetMs;
}

function loadFile(path: string): ToolQuotasFile {
  if (!existsSync(path)) {
    return { version: 1, providers: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw?.version !== 1 || typeof raw.providers !== "object") {
      return { version: 1, providers: {} };
    }
    return raw as ToolQuotasFile;
  } catch {
    return { version: 1, providers: {} };
  }
}

function saveFile(path: string, data: ToolQuotasFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Load tool quota entries for all configured providers. Missing providers
 * get default entries (used=0). Providers whose nextReset is in the past
 * are automatically reset.
 */
export function loadToolQuotas(
  path: string,
  config: Record<
    string,
    { resetDay?: number; monthLimit?: number; totalBudget?: number }
  >,
  timezone: string,
): Record<string, ToolQuotaEntry> {
  const file = loadFile(path);
  const now = Date.now();
  let dirty = false;
  const result: Record<string, ToolQuotaEntry> = {};

  for (const [provider, cfg] of Object.entries(config)) {
    let entry: ToolQuotaEntry = file.providers[provider] ?? {
      used: 0,
      lastReset: null,
      nextReset: cfg.resetDay
        ? computeNextReset(cfg.resetDay, timezone, now)
        : null,
      lastUpdated: now,
    };

    // Auto-reset if the reset window has passed
    if (cfg.resetDay && entry.nextReset !== null && entry.nextReset <= now) {
      entry = {
        used: 0,
        lastReset: now,
        nextReset: computeNextReset(cfg.resetDay, timezone, now),
        lastUpdated: now,
      };
      dirty = true;
    }

    file.providers[provider] = entry;
    result[provider] = entry;
  }

  if (dirty) {
    saveFile(path, file);
  }

  return result;
}

/**
 * Persist the given quota entries to disk, merging with any existing data.
 */
export function saveToolQuotas(
  path: string,
  quotas: Record<string, ToolQuotaEntry>,
): void {
  const file = loadFile(path);
  for (const [provider, entry] of Object.entries(quotas)) {
    file.providers[provider] = entry;
  }
  saveFile(path, file);
}

/**
 * Update a provider's usage value, persist immediately, and return the
 * updated entry.
 */
export function updateToolUsed(
  path: string,
  provider: string,
  value: number,
  existing: Record<string, ToolQuotaEntry>,
): ToolQuotaEntry {
  const prev = existing[provider];
  const entry: ToolQuotaEntry = {
    lastReset: prev?.lastReset ?? null,
    nextReset: prev?.nextReset ?? null,
    used: value,
    lastUpdated: Date.now(),
  };
  const file = loadFile(path);
  file.providers[provider] = entry;
  saveFile(path, file);
  return entry;
}
