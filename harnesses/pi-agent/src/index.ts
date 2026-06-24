import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerFridayTheme } from "./theme.ts";
import { registerFridayWeb } from "./web.ts";
import { registerSystemPromptInjector } from "./system-prompt.ts";
import { getFridayState, persistSessionMetrics } from "./runtime/state.ts";
import { bridgeGetDB, bridgeSetQuotaOrchestrator, bridgeGetQuotaOrchestrator, bridgeSetSessionStartMs, bridgeGetQuotaSnapshots, bridgeGetSessionStartMs, bridgeGetToolQuotas, bridgeSetToolQuotas } from "./shared/web-bridge.ts";
import { loadWebConfig } from "./web/config/loader.ts";
import { embeddingCache, queryCache } from "./web/runtime/lru-cache.ts";
import { QuotaOrchestrator } from "./web/runtime/quota-orchestrator.ts";
import { buildProbers } from "./web/runtime/probes/index.ts";
import { join } from "node:path";
import { buildUsageReport } from "./runtime/usage-report.ts";
import { SESSION_ID } from "./runtime/usage-recorder.ts";

export { registerFridayTheme, registerFridayWeb };

function fmtResetShort(ts: number, now: number): string {
  const diff = Math.max(0, ts - now);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  return d > 0 ? `resets in ${d}d ${h}h` : `resets in ${h}h`;
}

function buildUsageHelp(extra?: string): string {
  const cfg = loadWebConfig();
  const toolNames = Object.keys(cfg.quotas.toolProviders).join(" · ");
  const providerNames = [
    "anthropic", "openai-codex", "google", "google-vertex",
    "github-copilot", "kimi-coding", "zai", "opencode-go",
    "opencode", "vercel-ai-gateway",
  ].join(" · ");

  const lines = [
    `╔${"═".repeat(58)}╗`,
    `  📊 USAGE  ·  track costs, quotas, and provider limits`,
    `╚${"═".repeat(58)}╝`,
    "",
  ];
  if (extra) lines.push(`  ⚠ ${extra}`, "");
  lines.push(
    `  /usage                   Show full usage report (session + totals + quotas)`,
    `  /usage refresh           Re-probe all providers and refresh quota windows`,
    `  /usage setup <provider>  Step-by-step guide to enable tracking for a provider`,
    `  /usage update <tool> <n> Manually record tool provider usage (credits or $)`,
    "",
    `PROVIDERS    ${providerNames}`,
    "",
    `TOOL QUOTAS  ${toolNames}`,
    `             Update with:  /usage update <tool> <value>`,
             `             Set up reset: edit resetDay in ~/.pi/agent/extensions/friday/config/system.yml`,
    "",
    `  Tip: /usage setup <provider> shows what credentials are missing`,
    `       and the exact steps to enable full quota visibility.`,
  );
  return lines.join("\n");
}

function buildSetupGuide(provider: string, detected: string[]): string {
  const isActive = detected.includes(provider);
  const title = provider.toUpperCase();
  const header = [
    `╔${"═".repeat(46)}╗`,
    `  🔧 USAGE SETUP  ·  ${title}`,
    `╚${"═".repeat(46)}╝`,
    "",
  ];

  const toolProviders = ["brave", "tavily", "exa", "serper"];
  if (toolProviders.includes(provider)) {
    const cfg = loadWebConfig();
    const tc = cfg.quotas.toolProviders[provider];
    const tq = bridgeGetToolQuotas();
    const entry = tq[provider];
    const usedStr = entry ? String(entry.used) : "0";
    return [
      ...header,
      `STATUS`,
      `  ✓  Configured in system.yml  →  ${tc?.monthLimit ?? tc?.totalBudget ?? "?"} ${tc?.unit ?? "credits"}${tc?.monthLimit ? "/mo" : " budget"}`,
      `  ✓  state/tool-quotas.json    →  ${usedStr} ${tc?.unit ?? "credits"} used`,
      "",
      `HOW TO KEEP IT ACCURATE`,
      `  Tracking is manual — ${title} doesn't expose a quota API.`,
      "",
      `  After each session (or whenever you check usage):`,
      `    /usage update ${provider} <current_used>`,
      "",
      `  Check your actual usage at the provider dashboard.`,
      "",
      `RESET`,
      tc?.monthLimit
        ? tc.resetDay
          ? `  Auto-resets to 0 on day ${tc.resetDay} of each month (${cfg.timezone}).`
          : `  Auto-resets to 0 on day 1 of each month (${cfg.timezone}).`
        : `  No auto-reset — this is a lifetime budget.`,
    ].join("\n");
  }

  const guides: Record<string, string[]> = {
    anthropic: [
      `STATUS`,
      isActive ? `  ✓  Credentials detected` : `  ✗  No credentials found`,
      "",
      `WHAT YOU GET WITH FULL SETUP`,
      `  • 5h + 7d quota windows with % used and reset countdown`,
      `  • Account email + plan type`,
      `  • ~$cost estimates in footer via LiteLLM pricing`,
      "",
      `HOW TO SET UP`,
      `  Option A — OAuth (recommended):`,
      `    1. Run:  pi login anthropic`,
      `    2. Token saved to ~/.pi/agent/auth.json automatically`,
      "",
      `  Option B — API key:`,
      `    export ANTHROPIC_API_KEY="sk-ant-..."`,
      "",
      `  Run /usage refresh after setup to verify.`,
    ],
    "openai-codex": [
      `STATUS`,
      isActive ? `  ✓  Credentials detected` : `  ✗  No credentials found`,
      "",
      `WHAT YOU GET WITH FULL SETUP`,
      `  • 5h + 7d quota windows, plan type, account email`,
      `  • ~$cost estimates via LiteLLM pricing`,
      "",
      `HOW TO SET UP`,
      `  Option A — OAuth (recommended):`,
      `    1. Run:  pi login openai-codex`,
      `    2. Token saved to ~/.pi/agent/auth.json automatically`,
      "",
      `  Option B — API key:`,
      `    export OPENAI_API_KEY="sk-..."`,
    ],
    "opencode-go": [
      `STATUS`,
      isActive ? `  ✓  Credentials detected` : `  ✗  No credentials found`,
      "",
      `HOW TO SET UP`,
      `  1. Log in at https://opencode.ai and open your workspace dashboard`,
      `  2. Open browser DevTools (F12) → Application → Cookies → opencode.ai`,
      `  3. Copy the value of the "auth" cookie`,
      `  4. Get your workspace ID from the dashboard URL:`,
      `       https://opencode.ai/workspace/<WORKSPACE_ID>/go`,
      "",
      `  5. Set env vars (add to shell profile):`,
      `       export OPENCODE_GO_WORKSPACE_ID="<WORKSPACE_ID>"`,
      `       export OPENCODE_GO_AUTH_COOKIE="<auth cookie value>"`,
      "",
      `  Note: auth cookie expires — re-run /usage setup opencode-go to check.`,
    ],
  };

  const guide = guides[provider] ?? [
    `STATUS`,
    isActive ? `  ✓  Credentials detected` : `  ✗  No credentials found`,
    "",
    `  Run /usage refresh to test the connection after setup.`,
    `  See provider documentation for credential setup details.`,
  ];

  return [...header, ...guide].join("\n");
}

export default function registerFriday(pi: ExtensionAPI): void {
  registerFridayTheme(pi);
  registerFridayWeb(pi);
  registerSystemPromptInjector(pi);

  pi.registerCommand("usage", {
    description: "Show usage report, refresh quotas, update tool usage, or get provider setup guide.",
    noReply: true,
    async handler(args: string, ctx: any) {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? "";

      if (sub === "") {
        const cfg = loadWebConfig();
        const snaps = bridgeGetQuotaSnapshots();
        const tq = bridgeGetToolQuotas();
        const db = bridgeGetDB();
        const sessionId = SESSION_ID;
        const quotaPath = join((process.env.HOME ?? ""), ".pi", "agent", "extensions", "friday", "state", "quotas.json");

        const { sessionTotals, windowTotals } = await import("./runtime/usage-reader.ts");
        const cstatsRaw = db ? db.getCacheStatsSummary(bridgeGetSessionStartMs()) : { hard: 0, soft: 0, l1: 0, miss: 0, savedUsd: 0, savedTokens: 0 };

        const toolRows = Object.entries(cfg.quotas.toolProviders).map(([name, tc]) => ({
          name,
          used: tq[name]?.used ?? 0,
          limit: tc.monthLimit ?? tc.totalBudget ?? null,
          unit: tc.unit as "credits" | "usd" | "requests",
          nextReset: tq[name]?.nextReset ?? null,
          emoji: name === "brave" ? "🦁" : name === "tavily" ? "🔍" : name === "exa" ? "🔎" : "📡",
        }));

        const lastUpdated = Object.values(snaps).reduce((min, s) => Math.min(min, s.probedAt), Date.now());
        const text = buildUsageReport({
          now: Date.now(),
          timezone: cfg.timezone,
          sessionProviders: sessionTotals(quotaPath, sessionId),
          rollingWindows: {
            h5: windowTotals(quotaPath, 5 * 3600_000),
            d1: windowTotals(quotaPath, 24 * 3600_000),
            w1: windowTotals(quotaPath, 7 * 24 * 3600_000),
            mo1: windowTotals(quotaPath, 30 * 24 * 3600_000),
          },
          modelProviders: Object.values(snaps),
          toolProviders: toolRows,
          cacheStats: { l1: cstatsRaw.l1, hard: cstatsRaw.hard, soft: cstatsRaw.soft, miss: cstatsRaw.miss, tokensSaved: cstatsRaw.savedTokens, creditsSaved: cstatsRaw.savedUsd },
          lastUpdatedSec: Math.round((Date.now() - lastUpdated) / 1000),
        });
        ctx.ui.notify(text, "info");
        return;
      }

      if (sub === "refresh") {
        const orch = bridgeGetQuotaOrchestrator();
        if (!orch) { ctx.ui.notify("Quota orchestrator not initialised.", "warning"); return; }
        orch.clearCooldowns();
        ctx.ui.notify("Refreshing quotas...", "info");
        await orch.probeAll({ force: true });
        ctx.ui.notify("Quotas refreshed.", "info");
        return;
      }

      if (sub === "update") {
        const tool = parts[1];
        const valueStr = parts[2];
        if (!tool || !valueStr) {
          ctx.ui.notify("Usage: /usage update <tool> <value>\nExample: /usage update brave 150", "warning");
          return;
        }
        const cfg = loadWebConfig();
        const toolCfg = cfg.quotas.toolProviders[tool];
        if (!toolCfg) {
          ctx.ui.notify(`Unknown tool "${tool}". Known tools: ${Object.keys(cfg.quotas.toolProviders).join(", ")}`, "warning");
          return;
        }
        const value = parseFloat(valueStr);
        if (isNaN(value) || value < 0) {
          ctx.ui.notify(`Invalid value "${valueStr}" — must be a non-negative number.`, "warning");
          return;
        }
        const { updateToolUsed, DEFAULT_TOOL_QUOTAS_PATH } = await import("./runtime/tool-quota-store.ts");
        const existing = bridgeGetToolQuotas();
        const updated = updateToolUsed(DEFAULT_TOOL_QUOTAS_PATH, tool, value, existing);
        bridgeSetToolQuotas({ ...existing, [tool]: updated });
        const usedStr = toolCfg.unit === "usd" ? `$${value.toFixed(2)}` : String(value);
        const limStr = toolCfg.monthLimit ? `/ ${toolCfg.monthLimit}` : toolCfg.totalBudget ? `/ ${toolCfg.totalBudget}` : "";
        const limit = toolCfg.monthLimit ?? toolCfg.totalBudget;
        const pct = limit && limit > 0 ? ` (${Math.round((value / limit) * 100)}%)` : "";
        const reset = updated.nextReset ? `  ${fmtResetShort(updated.nextReset, Date.now())}` : "";
        ctx.ui.notify(`✓ ${tool}: ${usedStr} ${limStr} ${toolCfg.unit}${pct}${reset}`, "info");
        return;
      }

      if (sub === "setup") {
        const provider = parts[1];
        if (!provider) {
          ctx.ui.notify("Usage: /usage setup <provider>\nProviders: anthropic openai-codex google google-vertex github-copilot kimi-coding zai opencode-go opencode vercel-ai-gateway\nTool providers: brave tavily exa serper", "info");
          return;
        }
        const { detectActiveProviders } = await import("./web/runtime/provider-auth.ts");
        const active = detectActiveProviders();
        ctx.ui.notify(buildSetupGuide(provider, active), "info");
        return;
      }

      ctx.ui.notify(buildUsageHelp(`Unknown subcommand "${sub}".`), "info");
    },
  } as any);

  pi.on("session_start", async (_event, _ctx) => {
    embeddingCache.clear();
    queryCache.clear();
    bridgeSetSessionStartMs(Date.now());

    const cfg = loadWebConfig();
    const home = process.env.HOME ?? "";
    const quotaPath = join(home, ".pi", "agent", "extensions", "friday", "state", "quotas.json");
    const pricingPath = join(home, ".pi", "agent", "extensions", "friday", "state", "model-prices.json");

    // Warm tool-quota state (auto-resets overdue monthly providers)
    try {
      const { loadToolQuotas, DEFAULT_TOOL_QUOTAS_PATH } = await import("./runtime/tool-quota-store.ts");
      const tq = loadToolQuotas(DEFAULT_TOOL_QUOTAS_PATH, cfg.quotas.toolProviders, cfg.timezone);
      bridgeSetToolQuotas(tq);
    } catch { /* non-critical */ }

    // Warm LiteLLM pricing cache (non-blocking)
    void import("./runtime/model-pricing.ts").then(({ loadPricing }) => {
      void loadPricing(pricingPath);
    }).catch(() => {/* non-critical */});

    // Pre-compute provider→combinedBudget map once per session
    const combinedBudgetMap: Record<string, number> = {};
    for (const grp of Object.values(cfg.quotas.apiGroups ?? {})) {
      for (const p of (grp.providers as string[])) {
        combinedBudgetMap[p] = grp.combinedBudget;
      }
    }

    // Build probers with limits/budget callbacks
    const probers = buildProbers({
      authOpts: { home, env: process.env },
      getMonthlyLimitUsd: (p: string) => {
        const mp = cfg.quotas.modelProviders[p];
        return (mp as any)?.rolling1moLimit ?? null;
      },
      getCombinedBudgetUsd: (p: string) => combinedBudgetMap[p] ?? null,
      quotasPath: quotaPath,
    });

    const orchestrator = new QuotaOrchestrator({
      cooldownMs: 30_000,
      persistPath: join(cfg.paths.stateRoot, "quota-rate-limits.json"),
      probers,
    });
    bridgeSetQuotaOrchestrator(orchestrator);
    setTimeout(() => { void orchestrator.probeAll(); }, 250);

    try {
      const db = bridgeGetDB();
      if (db) db.gc();
    } catch {
      // non-critical
    }
  });

  pi.on("turn_end", (_event, ctx) => {
    if (!ctx.hasUI) return;
    const state = getFridayState(ctx);
    state.activeElapsedMs += Date.now() - state.activeStartMs;
    state.activeStartMs = Date.now();
    persistSessionMetrics(pi, ctx);

    const provider = ((ctx as any).model?.provider ?? "").toLowerCase();
    if (provider) void bridgeGetQuotaOrchestrator()?.probe(provider);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    embeddingCache.clear();
    queryCache.clear();

    const orchestrator = bridgeGetQuotaOrchestrator();
    if (orchestrator) orchestrator.flushPending();

    // Flush usage recorder pending writes
    try {
      const { flushDefaultRecorder } = await import("./runtime/usage-recorder.ts");
      flushDefaultRecorder();
    } catch { /* non-critical */ }

    // Persist tool quotas (saves current state including resets)
    try {
      const { saveToolQuotas, DEFAULT_TOOL_QUOTAS_PATH } = await import("./runtime/tool-quota-store.ts");
      const tq = bridgeGetToolQuotas();
      if (Object.keys(tq).length > 0) await saveToolQuotas(DEFAULT_TOOL_QUOTAS_PATH, tq);
    } catch { /* non-critical */ }

    const state = getFridayState(ctx);
    state.activeElapsedMs += Date.now() - state.activeStartMs;
    state.activeStartMs = Date.now();
    persistSessionMetrics(pi, ctx);

    try {
      const db = bridgeGetDB();
      if (db) db.clearSessionStatsRing();
    } catch {
      // non-critical
    }
  });
}
