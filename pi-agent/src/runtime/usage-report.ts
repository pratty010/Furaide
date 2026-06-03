import type { ProviderRateLimits } from "../web/runtime/quota-probe.ts";
import type { ProviderTotals } from "./usage-reader.ts";
import type { StatsSummary } from "../web/runtime/cache-stats.ts";

export interface ToolProviderRow {
  name: string;
  used: number;
  limit: number | null;
  unit: "credits" | "usd" | "requests";
  nextReset: number | null;
  emoji: string;
}

export interface ReportInput {
  now: number;
  timezone: string;
  sessionProviders: Record<string, ProviderTotals>;
  rollingWindows: {
    h5: Record<string, ProviderTotals>;
    d1: Record<string, ProviderTotals>;
    w1: Record<string, ProviderTotals>;
    mo1: Record<string, ProviderTotals>;
  };
  modelProviders: ProviderRateLimits[];
  toolProviders: ToolProviderRow[];
  cacheStats: StatsSummary;
  lastUpdatedSec: number;
}

const BOX_W = 58;
const LINE = "─".repeat(BOX_W);

// Map of IANA timezone IDs to common abbreviations for environments
// where Intl.DateTimeFormat timeZoneName:"short" returns GMT offsets.
const KNOWN_TZ_ABBR: Record<string, string> = {
  "Asia/Kolkata": "IST",
  "Asia/Shanghai": "CST",
  "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST",
  "Asia/Singapore": "SGT",
  "Asia/Hong_Kong": "HKT",
  "Asia/Dubai": "GST",
  "Europe/London": "GMT",
  "Europe/Paris": "CET",
  "Europe/Berlin": "CET",
  "Europe/Moscow": "MSK",
  "America/New_York": "EST",
  "America/Chicago": "CST",
  "America/Denver": "MST",
  "America/Los_Angeles": "PST",
  "Australia/Sydney": "AEST",
  "Pacific/Auckland": "NZST",
};

function tzAbbr(timezone: string, date: Date): string {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")!.value;
  // If Intl returned a GMT offset string, use our known mapping
  if (raw.startsWith("GMT") || raw.startsWith("UTC")) {
    return KNOWN_TZ_ABBR[timezone] ?? raw;
  }
  return raw;
}

function header(r: ReportInput): string {
  const date = new Date(r.now);
  const dow = date.toLocaleDateString("en-US", { timeZone: r.timezone, weekday: "short" });
  const dateStr = date.toLocaleDateString("en-US", { timeZone: r.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
  const timeStr = date.toLocaleTimeString("en-US", { timeZone: r.timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const tz = tzAbbr(r.timezone, date);
  return [
    `╔${"═".repeat(BOX_W)}╗`,
    `  📊 USAGE REPORT  ·  ${dow} ${dateStr}  ·  ${timeStr} ${tz}`,
    `╚${"═".repeat(BOX_W)}╝`,
  ].join("\n");
}

function fmtCost(n: number, est = false): string {
  const s = n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(3);
  return est ? `~$${s}` : `$${s}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtReset(ts: number | null, now: number): string {
  if (!ts) return "";
  const diff = Math.max(0, ts - now);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `resets in ${d}d ${h}h`;
  if (h > 0) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

function sessionSection(r: ReportInput): string {
  const entries = Object.entries(r.sessionProviders);
  if (entries.length === 0) return "";
  const lines = [`SESSION ${"─".repeat(BOX_W - 8)}`];
  for (const [provider, t] of entries) {
    const topModel = Object.entries(t.byModel).sort((a, b) => b[1].messages - a[1].messages)[0];
    const modelStr = topModel ? topModel[0] : "";
    const costStr = fmtCost(t.costUsd, true);
    lines.push(`  ${provider.toUpperCase().padEnd(14)} ${modelStr.padEnd(22)} ${costStr.padStart(8)}  ${fmtNum(t.messages)} msgs`);
  }
  return lines.join("\n");
}

function rollingSection(r: ReportInput): string {
  const allProviders = new Set<string>([
    ...Object.keys(r.rollingWindows.h5),
    ...Object.keys(r.rollingWindows.d1),
    ...Object.keys(r.rollingWindows.w1),
    ...Object.keys(r.rollingWindows.mo1),
  ]);
  if (allProviders.size === 0) return "";
  const lines = [
    `ROLLING USAGE ${"─".repeat(BOX_W - 14)}`,
    `  ${"Provider".padEnd(16)} ${"5h".padStart(8)} ${"1d".padStart(8)} ${"1w".padStart(9)} ${"30d".padStart(9)}`,
    `  ${"─".repeat(BOX_W - 2)}`,
  ];
  for (const p of allProviders) {
    const h5 = r.rollingWindows.h5[p]?.costUsd;
    const d1 = r.rollingWindows.d1[p]?.costUsd;
    const w1 = r.rollingWindows.w1[p]?.costUsd;
    const mo1 = r.rollingWindows.mo1[p]?.costUsd;
    const fmt = (v: number | undefined) => v !== undefined ? fmtCost(v, true) : "  —";
    lines.push(`  ${p.toUpperCase().padEnd(16)} ${fmt(h5).padStart(8)} ${fmt(d1).padStart(8)} ${fmt(w1).padStart(9)} ${fmt(mo1).padStart(9)}`);
  }
  return lines.join("\n");
}

function quotasSection(r: ReportInput): string {
  if (r.modelProviders.length === 0) return "";
  const lines = [`PROVIDER QUOTAS ${"─".repeat(BOX_W - 16)}`];
  for (const rl of r.modelProviders) {
    const nameStr = rl.provider.toUpperCase();
    const planStr = rl.plan ? `  ·  ${rl.plan}` : "";
    const acctStr = rl.account ? `  ·  ${rl.account}` : "";
    lines.push(`  ${nameStr}${planStr}${acctStr}`);
    if (rl.error) {
      lines.push(`     ⚠ ${rl.error}`);
    } else if (rl.windows.length > 0) {
      const wins = rl.windows.map((w) => {
        const pct = `${w.percentUsed}%`;
        const reset = w.resetAt ? ` (${fmtReset(w.resetAt, r.now)})` : "";
        return `${w.label}: ${pct}${reset}`;
      });
      lines.push(`     ${wins.join("  ·  ")}`);
    } else if (rl.apiCostTotal !== null) {
      lines.push(`     ~$${rl.apiCostTotal.toFixed(3)} (local estimate)`);
    }
    if (rl.note) lines.push(`     ℹ ${rl.note}`);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function toolsSection(r: ReportInput): string {
  if (r.toolProviders.length === 0) return "";
  const lines = [`TOOL PROVIDERS ${"─".repeat(BOX_W - 15)}`];
  for (const t of r.toolProviders) {
    const usedStr = t.unit === "usd" ? `$${t.used.toFixed(2)}` : fmtNum(t.used);
    const limStr = t.limit !== null ? (t.unit === "usd" ? `$${t.limit.toFixed(2)}` : fmtNum(t.limit)) : "—";
    const unitLabel = t.unit === "usd" ? "" : t.unit === "credits" ? " credits/mo" : ` ${t.unit}`;
    const pct = t.limit !== null && t.limit > 0 ? `(${((t.used / t.limit) * 100).toFixed(1)}%)` : "";
    const reset = t.nextReset ? fmtReset(t.nextReset, r.now) : "";
    const name = `${t.emoji} ${t.name.toUpperCase()}`;
    lines.push(`  ${name.padEnd(12)} ${`${usedStr} / ${limStr}${unitLabel}`.padEnd(26)} ${pct.padEnd(7)} ${reset}`);
  }
  return lines.join("\n");
}

function cacheSection(r: ReportInput): string {
  const s = r.cacheStats;
  const tokSaved = s.tokensSaved >= 1000 ? `${(s.tokensSaved / 1000).toFixed(1)}k` : String(s.tokensSaved);
  const total = s.l1 + s.hard + s.soft + s.miss;
  const hitPct = total > 0 ? Math.round(((s.l1 + s.hard + s.soft) / total) * 100) : 0;
  return [
    `TOOL CACHE ${"─".repeat(BOX_W - 11)}`,
    `  L1 hits: ${hitPct}%  ·  Tokens saved: ${tokSaved}`,
  ].join("\n");
}

export function buildUsageReport(r: ReportInput): string {
  const ago = r.lastUpdatedSec < 60
    ? `${r.lastUpdatedSec}s ago`
    : `${Math.round(r.lastUpdatedSec / 60)}m ago`;

  const sections = [
    header(r),
    "",
    sessionSection(r),
    "",
    rollingSection(r),
    "",
    quotasSection(r),
    toolsSection(r),
    "",
    cacheSection(r),
    "",
    `  Refreshed ${ago}  ·  /usage refresh to update quotas`,
  ].filter((s) => s !== null);

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
