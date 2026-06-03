import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { sessionTotals } from "../runtime/usage-reader.ts";
import { SESSION_ID, DEFAULT_QUOTA_PATH } from "../runtime/usage-recorder.ts";
import { bridgeGetToolQuotas } from "../shared/web-bridge.ts";
import {
  collectSessionMetrics,
  getTotalAccumulatedSessionMs,
  startAccumulatedSession,
  stopAccumulatedSession,
  loadPersistedTotal,
  writePersistedTotal,
  seedAccumulatedTotal,
  DEFAULT_TOTAL_MS_PATH,
} from "./session-metrics.ts";
import {
  formatTokenCount,
  formatMoney,
  shortSessionId,
} from "../runtime/state.ts";
import { pickTemplate, type TemplateRender } from "../templates/index.ts";
import * as status from "./status.ts";
import type { WebStatusSnap } from "../web/web-activity.ts";
import type { StatusSnapshot } from "./status.ts";
import { bridgeGetDB, bridgeGetWebSnap, bridgeGetQuotaSnapshots, bridgeGetSessionStartMs } from "../shared/web-bridge.ts";
import { getLastCacheOutcome, type LastCacheOutcome } from "../runtime/last-cache-outcome.ts";
import { loadWebConfig } from "../web/config/loader.ts";
import type { WebConfig } from "../web/config/schema.ts";
import type { KnowledgeDB } from "../web/runtime/db.ts";
import type { ProviderRateLimits } from "../web/runtime/quota-probe.ts";

const WIDGET_KEY = "friday-session";

// Reads current session totals for the active provider (synchronous — no async needed)
function getSessionChip(provider: string, _theme: FridayTheme): string | null {
  const totals = sessionTotals(DEFAULT_QUOTA_PATH, SESSION_ID);
  const t = totals[provider];
  if (!t || t.messages === 0) return null;
  const costStr = t.costUsd > 0 ? `  ~$${t.costUsd.toFixed(3)}` : "";
  return `${provider}  ·  ${t.messages} msgs${costStr}`;
}

let widgetTuiRef: any = null;
let tokTickTimer: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let chosenTemplate: TemplateRender | null = null;
let sessionStartMs = 0;

function padToWidth(text: string, width: number): string {
  const vw = visibleWidth(text);
  return vw < width ? text + " ".repeat(width - vw) : text;
}

export function centerVertically(lines: string[], numRows: number): string[] {
  if (lines.length >= numRows) return lines;
  const diff = numRows - lines.length;
  const top = Math.floor(diff / 2);
  const bot = diff - top;
  return [...Array(top).fill(""), ...lines, ...Array(bot).fill("")];
}

export function wrapChips(chips: string[], separator: string, maxWidth: number): string[][] {
  if (chips.length === 0) return [];
  const rows: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;
  for (const chip of chips) {
    const chipW = visibleWidth(chip);
    const sepW  = current.length > 0 ? visibleWidth(separator) : 0;
    if (current.length > 0 && currentWidth + sepW + chipW > maxWidth) {
      rows.push(current);
      current = [chip];
      currentWidth = chipW;
    } else {
      current.push(chip);
      currentWidth += sepW + chipW;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

type QuotaUnit = "credits" | "usd" | "requests";

export type ToolProviderQuota = {
  label: string;
  stat: { used: number; limit: number | null; unit: QuotaUnit; calledCount: number };
};

type FridayThemeColor =
  | "accent"
  | "dim"
  | "muted"
  | "text"
  | "success"
  | "amber"
  | "error"
  | "error"
  | "warning"
  | "secondary";

interface FridayTheme {
  fg: (color: FridayThemeColor, text: string) => string;
}

export function formatQuotaChip(
  theme: FridayTheme,
  label: string,
  stat: { used: number; limit: number | null; unit: QuotaUnit },
): string {
  if (stat.limit == null) return theme.fg("text", `${label} -`);
  let pct = 0;
  if (stat.limit === 0) {
    pct = stat.used === 0 ? 0 : 100;
  } else {
    pct = Math.round((stat.used / stat.limit) * 100);
  }

  const formatValue = (val: number) => {
    if (stat.unit === "usd") {
      const s = val.toFixed(2);
      return s.endsWith(".00") ? s.slice(0, -3) : s;
    }
    return val.toString();
  };

  const usedStr = stat.unit === "usd" ? `$${formatValue(stat.used)}` : formatValue(stat.used);
  const limitStr = stat.unit === "usd" ? `$${formatValue(stat.limit)}` : formatValue(stat.limit);

  const text = `${label}: ${usedStr}/${limitStr} (${pct}%)`;

  let color: FridayThemeColor = "success";
  if (stat.limit === 0) {
    color = stat.used === 0 ? "text" : "error";
  } else {
    if (pct >= 95) color = "error";
    else if (pct >= 75) color = "amber";
  }

  return theme.fg(color, text);
}

interface Window {
  used: number;
  limit: number;
}

type QuotaDB = Pick<KnowledgeDB, "listUsage" | "getUsage">;

function normalizeQuotaUnit(unit: string): QuotaUnit {
  if (unit === "usd" || unit === "requests") return unit;
  return "credits";
}

function quotaLabel(provider: string): string {
  const known: Record<string, string> = {
    brave: "brave",
    tavily: "tvly",
    exa: "exa",
    serper: "serper",
    opencode: "oc",
  };
  return known[provider] ?? provider;
}

export function formatSubscriptionChip(
  label: string,
  stat: { current: number; rolling5h: Window | null; rolling1w: Window | null; rolling1mo: Window | null },
): string {
  const win = (w: Window | null) => w == null
    ? "-"
    : `${w.used}/${w.limit} (${Math.round((w.used / w.limit) * 100)}%)`;
  return `${label} ${stat.current} . ${win(stat.rolling5h)} . ${win(stat.rolling1w)} . ${win(stat.rolling1mo)}`;
}

export function formatModelProviderChip(rl: ProviderRateLimits): string {
  if (rl.error) return `${rl.provider}: —`;
  if (rl.windows.length > 0) {
    const most = rl.windows.reduce((a, b) => a.percentUsed > b.percentUsed ? a : b);
    return `${rl.provider}: ${most.percentUsed}% (${most.label})`;
  }
  if (rl.apiCostTotal !== null) {
    return `${rl.provider}: $${rl.apiCostTotal.toFixed(2)} total`;
  }
  return `${rl.provider}: —`;
}

export function formatCacheStatsLine(s: { l1: number; hard: number; soft: number; miss: number; tokensSaved: number; creditsSaved: number }): string {
  const tok = s.tokensSaved >= 1000 ? `${(s.tokensSaved / 1000).toFixed(1)}k` : String(s.tokensSaved);
  return `hard: ${s.hard} · soft: ${s.soft} · l1: ${s.l1} · miss: ${s.miss} · saved: $${s.creditsSaved.toFixed(3)} · ↑ ${tok} tok`;
}

export function formatLastCacheOutcome(o: LastCacheOutcome): string {
  const kanji = o.outcome === "miss" ? "行" : "了";
  const text = o.outcome === "l1_hit" ? "L1 hit"
             : o.outcome === "hard"   ? "hard hit"
             : o.outcome === "soft"   ? "soft hit"
             :                          "live fetch (miss)";
  const sim = o.similarity != null ? ` (sim ${o.similarity.toFixed(2)})` : "";
  return `● ${kanji}  ${o.tool} · ${text}${sim}`;
}

const CORE_PROVIDERS = ["brave", "tavily", "exa", "serper"] as const;

export function collectQuotaStats(cfg: WebConfig, _db: QuotaDB | null, _now = Date.now()) {
  const providersCfg = cfg?.quotas?.toolProviders ?? {};
  const tq = bridgeGetToolQuotas();

  return {
    toolProviders: CORE_PROVIDERS.map((provider) => {
      const quotaCfg = (providersCfg as any)[provider];
      const unit = normalizeQuotaUnit(quotaCfg?.unit ?? "credits");
      const tqEntry = tq[provider];
      const used = tqEntry?.used ?? 0;
      const limit: number | null =
        typeof quotaCfg?.monthLimit === "number" ? quotaCfg.monthLimit
        : typeof quotaCfg?.totalBudget === "number" ? quotaCfg.totalBudget
        : null;

      return {
        label: quotaLabel(provider),
        stat: { used, limit, unit, calledCount: used > 0 ? 1 : 0 },
      };
    }),
  };
}

const SECTIONS: ReadonlyArray<{ key: string; en: string; ja: string }> = [
  { key: "STATUS",  en: "STATUS",  ja: "状態" },
  { key: "SYSTEM",  en: "SYSTEM",  ja: "システム" },
  { key: "QUOTAS",  en: "QUOTAS",  ja: "割り当て" },
  { key: "SESSION", en: "SESSION", ja: "セッション" },
];

/** Look up a section's en/ja labels by key. Returns undefined for unknown keys. */
export function sectionLabel(key: string): { en: string; ja: string } | undefined {
  return SECTIONS.find((s) => s.key === key);
}

export function sectionHeader(theme: FridayTheme, en: string, ja: string, width: number): string {
  const gap = width - visibleWidth(en) - visibleWidth(ja);
  return theme.fg("accent", en) + " ".repeat(Math.max(0, gap)) + theme.fg("muted", ja);
}

export function subRow(theme: FridayTheme, content: string): string {
  return theme.fg("dim", "┃  ") + content;
}

/** Whether the QUOTAS section should be rendered (has tool or subscription quotas). */
export function shouldShowQuotas(stats: { toolProviders: unknown[]; subscriptions: unknown[] }): boolean {
  return stats.toolProviders.length > 0 || stats.subscriptions.length > 0;
}

/** Whether SESSION I/O and cost rows should be shown (requires message activity). */
export function shouldShowSessionMetrics(metrics: { assistantCount: number; userCount: number }): boolean {
  return metrics.assistantCount > 0 || metrics.userCount > 0;
}

/** Format the STATUS detail row. Uses webOverride when present, otherwise falls back to snapshot. */
export function formatStatusDetail(
  theme: FridayTheme,
  webOverride: WebStatusSnap | null,
  snapshot?: StatusSnapshot,
): string {
  if (webOverride) {
    const isError = webOverride.phase === "error";
    const kanji   = isError ? "断" : webOverride.phase === "done" || webOverride.phase === "cache" ? "了" : "行";
    const color: FridayThemeColor = isError ? "error" : webOverride.phase === "done" || webOverride.phase === "cache" ? "success" : "warning";
    return theme.fg(color, `● ${kanji}`) + "  " +
           theme.fg("text", "web") + theme.fg("dim", " · ") +
           theme.fg("muted", webOverride.detail);
  }
  if (snapshot) {
    return theme.fg(snapshot.color as FridayThemeColor, `● ${snapshot.kanji}`) + "  " +
           theme.fg("muted", snapshot.subheader);
  }
  return "";
}

function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatSessionRow(args: { now: number; sessionStart: number; totalAccumMs: number; timeZone?: string }): string {
  const { now, sessionStart, totalAccumMs, timeZone } = args;
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  if (timeZone) opts.timeZone = timeZone;
  const timeStr = new Date(now).toLocaleTimeString("en-IN", opts);
  const el = formatElapsed(now - sessionStart);
  const tot = formatElapsed(totalAccumMs);
  return `${timeStr} · ${el} · ${tot}`;
}

interface FridayCommand {
  name: string;
  source: string;
  sourceInfo?: {
    source?: string;
    path?: string;
  };
}

interface FridayExtensionContext {
  hasUI: boolean;
  model?: {
    name?: string;
    provider?: string;
  };
  cwd?: string;
  sessionManager: {
    getSessionId: () => string;
  };
  ui: {
    setWidget: (key: string, factory: (tui: any, theme: FridayTheme) => any, options?: any) => void;
    getAllThemes?: () => any[];
  };
}

export function registerWidgets(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const fctx = ctx as unknown as FridayExtensionContext;
    if (!fctx.hasUI) return;

    status.resetForSession();
    if (fctx.model?.name) status.setModel(fctx.model.name);
    const _sessionProviderKey = (fctx.model?.provider ?? "").toLowerCase();
    seedAccumulatedTotal(loadPersistedTotal());
    chosenTemplate = pickTemplate();
    sessionStartMs = Date.now();
    startAccumulatedSession(sessionStartMs);

    const fpi = pi as any;
    const allCommands: FridayCommand[] = fpi.getCommands?.() ?? [];
    const skillsCount = allCommands.filter((c) => c.source === "skill").length;
    const extCmds = allCommands.filter((c) => c.source === "extension");
    const extCount = new Set(
      extCmds.map((c) => c.sourceInfo?.source ?? c.sourceInfo?.path ?? c.name)
    ).size;
    const allThemes = fctx.ui.getAllThemes?.() ?? [];
    const themesCount = allThemes.length;

    let promptsCount = 0;
    try {
      const agentDir = process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME}/.pi/agent`;
      const { readdirSync } = require("fs");
      promptsCount = (readdirSync(`${agentDir}/prompts`, { withFileTypes: true }) as any[])
        .filter((f) => f.isFile()).length;
    } catch {
      // prompts dir absent
    }

    const cwd = (fctx.cwd || process.cwd()).replace(/^\/home\/[^/]+/, "~");
    const webCfg = loadWebConfig();

    fctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        widgetTuiRef = tui;
        return {
          dispose() {
            if (tokTickTimer) {
              clearInterval(tokTickTimer);
              tokTickTimer = null;
            }
            if (elapsedTimer) {
              clearInterval(elapsedTimer);
              elapsedTimer = null;
            }
          },
          invalidate() {},
          render(width: number) {
            const metrics = collectSessionMetrics(ctx);
            const sessionId = shortSessionId(fctx.sessionManager.getSessionId());

            const activeTools = fpi.getActiveTools?.() ?? [];
            const activeCount = activeTools.length;
            const totalCount = fpi.getAllTools?.().length ?? activeCount;

            const LEFT_W  = Math.floor(width * 0.26);
            const RIGHT_W = width - LEFT_W - 3;
            const panelDivider = theme.fg("dim", "│");

            const leftLines = chosenTemplate
              ? chosenTemplate(theme, LEFT_W)
              : [" ".repeat(LEFT_W), " ".repeat(LEFT_W), " ".repeat(LEFT_W), " ".repeat(LEFT_W)];

            // ── Build right-side rows section by section ────────────────────────────
            const rows: string[] = [];

            // STATUS
            const statusLabel = sectionLabel("STATUS")!;
            rows.push(sectionHeader(theme, statusLabel.en, statusLabel.ja, RIGHT_W));
            const webOverride = bridgeGetWebSnap();
            rows.push(subRow(theme, formatStatusDetail(theme, webOverride, status.snapshot())));

            const lastCache = getLastCacheOutcome();
            if (lastCache) {
              rows.push(subRow(theme, theme.fg("muted", formatLastCacheOutcome(lastCache))));
            }
            rows.push("");

            // SYSTEM
            const systemLabel = sectionLabel("SYSTEM")!;
            rows.push(sectionHeader(theme, systemLabel.en, systemLabel.ja, RIGHT_W));
            rows.push(subRow(theme, theme.fg("muted", "📂") + "  " + theme.fg("text", cwd)));
            rows.push(subRow(theme,
              theme.fg("muted", "🧰") + "  " + theme.fg("success", String(activeCount)) + theme.fg("dim", "/") + theme.fg("text", String(totalCount)) + " " + theme.fg("dim", "▰ ") +
              theme.fg("muted", "🎨") + "  " + theme.fg("success", String(themesCount)) + " " + theme.fg("dim", "▰ ") +
              theme.fg("muted", "🧠") + "  " + theme.fg("success", String(skillsCount)) + " " + theme.fg("dim", "▰ ") +
              theme.fg("muted", "🧩") + "  " + theme.fg("success", String(extCount)) + " " + theme.fg("dim", "▰ ") +
              theme.fg("muted", "📝") + "  " + theme.fg("success", String(promptsCount))
            ));
            rows.push("");

            // QUOTAS
            const quotaStats = collectQuotaStats(webCfg, bridgeGetDB(), Date.now());
            const activeProvider = (fctx.model?.provider ?? "").toLowerCase();
            const toolQuotas = quotaStats.toolProviders;

            const modelSnapshots = bridgeGetQuotaSnapshots();
            const modelChips = Object.values(modelSnapshots)
              .filter(rl => !rl.error && (rl.windows.length > 0 || rl.apiCostTotal !== null))
              .map(rl => formatModelProviderChip(rl));

            // Build active-provider subscription chip from usage-reader
            let subsLine: string | null = null;
            const chip = getSessionChip(activeProvider, theme);
            if (chip) subsLine = `${theme.fg("muted", "🤖")}  ${theme.fg("text", chip)}`;
            const hasToolQuotas = toolQuotas.length > 0;
            const hasModelQuotas = modelChips.length > 0;
            const hasSubs = subsLine !== null;
            if (shouldShowQuotas({ toolProviders: toolQuotas, subscriptions: (hasSubs || hasModelQuotas) ? [true] : [] })) {
              const quotasLabel = sectionLabel("QUOTAS")!;
              rows.push(sectionHeader(theme, quotasLabel.en, quotasLabel.ja, RIGHT_W));

              const db = bridgeGetDB();
              if (db) {
                const sessionStartMs = bridgeGetSessionStartMs();
                const cstatsRaw = db.getCacheStatsSummary(sessionStartMs);
                const cstats = {
                  l1: cstatsRaw.l1,
                  hard: cstatsRaw.hard,
                  soft: cstatsRaw.soft,
                  miss: cstatsRaw.miss,
                  tokensSaved: cstatsRaw.savedTokens,
                  creditsSaved: cstatsRaw.savedUsd,
                };
                rows.push(theme.fg("muted", "  CACHE  ") + theme.fg("muted", formatCacheStatsLine(cstats)));
              }
              
              if (hasToolQuotas) {
                const rawChips = toolQuotas.map((q) => formatQuotaChip(theme, q.label, q.stat));
                const TOOLS_LABEL = "  TOOLS  ";
                const TOOLS_W = TOOLS_LABEL.length;
                const quotaChipW = RIGHT_W - TOOLS_W; 
                const chipRows = wrapChips(rawChips, " · ", quotaChipW);
                for (let i = 0; i < chipRows.length; i++) {
                  const prefix = i === 0
                    ? theme.fg("muted", TOOLS_LABEL)
                    : " ".repeat(TOOLS_W);
                  const line = prefix + chipRows[i]!.join(theme.fg("dim", " · "));
                  rows.push(line);
                }
              }

              if (hasModelQuotas) {
                const MODELS_LABEL = "  MODELS ";
                const MODELS_W = MODELS_LABEL.length;
                const modelChipW = RIGHT_W - MODELS_W;
                const chipRows = wrapChips(modelChips, " · ", modelChipW);
                for (let i = 0; i < chipRows.length; i++) {
                  const prefix = i === 0
                    ? theme.fg("muted", MODELS_LABEL)
                    : " ".repeat(MODELS_W);
                  const line = prefix + chipRows[i]!.map(c => theme.fg("text", c)).join(theme.fg("muted", " · "));
                  rows.push(line);
                }
              }

              if (hasSubs) {
                rows.push("  " + subsLine!);
              }
              rows.push("");
            }

            // SESSION
            const sessionLabel = sectionLabel("SESSION")!;
            rows.push(sectionHeader(theme, sessionLabel.en, sessionLabel.ja, RIGHT_W));
            const sessionTotal = getTotalAccumulatedSessionMs();
            const sessionText = formatSessionRow({ now: Date.now(), sessionStart: sessionStartMs, totalAccumMs: sessionTotal, timeZone: webCfg.timezone });
            rows.push(subRow(theme,
              theme.fg("muted", "🔖") + "  " + theme.fg("text", "#" + sessionId) + theme.fg("dim", "  ·  ") +
              theme.fg("text", sessionText)
            ));
            if (shouldShowSessionMetrics(metrics)) {
              const cacheTotal = metrics.cacheRead + metrics.tokenIn;
              const hitPct = metrics.cacheRead > 0 && cacheTotal > 0
                ? Math.round((metrics.cacheRead / cacheTotal) * 100) : -1;
              const cacheStr = metrics.cacheRead > 0
                ? `  ${theme.fg("dim", "·")}  ${theme.fg("muted", "♻")}  ${theme.fg("accent", formatTokenCount(metrics.cacheRead))} cached${hitPct >= 0 ? ` (${hitPct}%)` : ""}`
                : "";
              rows.push(subRow(theme,
                theme.fg("muted", "📡") + "  " +
                theme.fg("accent", "↑ ") + theme.fg("text", formatTokenCount(metrics.tokenIn)) + "  " +
                theme.fg("secondary", "↓ ") + theme.fg("text", formatTokenCount(metrics.tokenOut)) +
                cacheStr
              ));
              const costStr = metrics.totalCost > 0 ? formatMoney(metrics.totalCost) : "$0.000";
              rows.push(subRow(theme,
                theme.fg("muted", "💬") + "  " +
                theme.fg("muted", "👤") + "  " + theme.fg("text", String(metrics.userCount))       + "  " +
                theme.fg("muted", "🤖") + "  " + theme.fg("text", String(metrics.assistantCount))  + "  " +
                theme.fg("muted", "🔧") + "  " + theme.fg("text", String(metrics.toolCount)) +
                theme.fg("dim", "  ·  ") +
                theme.fg("muted", "💰") + "  " + theme.fg("text", costStr)
              ));
            }

            const rightLines = rows.map((r) => truncateToWidth(r, RIGHT_W, ""));

            const numRows = Math.max(leftLines.length, rightLines.length);
            const centeredLeft = centerVertically(leftLines, numRows);
            return Array.from({ length: numRows }, (_, i) => {
              const l = centeredLeft[i] ?? " ".repeat(LEFT_W);
              const r = i < rightLines.length ? padToWidth(rightLines[i]!, RIGHT_W) : " ".repeat(RIGHT_W);
              return padToWidth(l, LEFT_W) + " " + panelDivider + " " + r;
            });
          },
        };
      },
      { placement: "aboveEditor" }
    );

    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => widgetTuiRef?.requestRender(), 30_000);

    if (tokTickTimer) clearInterval(tokTickTimer);
    tokTickTimer = setInterval(() => {
      const k = status.snapshot().kind;
      if (k === "streaming_text" || k === "streaming_thinking") widgetTuiRef?.requestRender();
    }, 500);
  });

  pi.on("before_agent_start", () => {
    status.onBeforeAgentStart();
    widgetTuiRef?.requestRender();
  });
  pi.on("agent_end", () => {
    status.onAgentEnd();
    widgetTuiRef?.requestRender();
  });
  pi.on("tool_execution_start", (event) => {
    status.onToolStart((event as any).toolName ?? "tool");
    widgetTuiRef?.requestRender();
  });
  pi.on("tool_execution_end", (event) => {
    const ev = event as any;
    const isError = !!ev.error;
    const msg = typeof ev.error === "string" ? ev.error : (ev.error?.message ?? "");
    status.onToolEnd(isError, msg);
    widgetTuiRef?.requestRender();
  });
  pi.on("message_update", (event) => {
    const ame = (event as any).assistantMessageEvent;
    if (ame) status.onMessageUpdate(ame);
    widgetTuiRef?.requestRender();
  });
  pi.on("turn_end", (_event, _ctx) => {
    widgetTuiRef?.requestRender();
  });
  pi.on("session_shutdown", () => {
    try { writePersistedTotal(DEFAULT_TOTAL_MS_PATH, getTotalAccumulatedSessionMs()); } catch {}
    stopAccumulatedSession();
    if (tokTickTimer) {
      clearInterval(tokTickTimer);
      tokTickTimer = null;
    }
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  });
}

export default registerWidgets;
