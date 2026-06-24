import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { getFridayState, providerEmoji, modelDisplayName, formatTokenCount, toolEmoji } from "../runtime/state.ts";
import { estimateCost } from "../runtime/model-pricing.ts";
import { recordUsage } from "../runtime/usage-recorder.ts";
import { readGitDirty, formatGitDirty } from "./git-status.ts";
import { loadWebConfig } from "../web/config/loader.ts";
import { DEFAULT_WEB_CONFIG } from "../web/config/schema.ts";

export function padToWidth(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

export function computeRowMaxWidths(samples: string[]): number {
  return samples.reduce((max, s) => Math.max(max, visibleWidth(s)), 0);
}

function fmtTok(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number | undefined): string {
  if (n === undefined) return "—";
  return n >= 100 ? n.toFixed(2) : n.toFixed(3);
}

export function formatTurnRow(args: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  callsCount: number | undefined;
  lastToolEmoji: string | undefined;
  costUsd: number | undefined;
  isEstimate: boolean;
}): string {
  const io = `🪙 : ↑ ${fmtTok(args.inputTokens)} /↓ ${fmtTok(args.outputTokens)}`;
  const calls =
    args.callsCount === undefined
      ? `🛠  : — (—)`
      : `🛠  : ${args.callsCount} (${args.lastToolEmoji ?? "—"})`;
  const prefix = args.costUsd !== undefined && args.isEstimate ? "~$" : "$";
  const cost = args.costUsd !== undefined ? `💵 : ${prefix}${fmtCost(args.costUsd)}` : `💵 : —`;
  return `${io} · ${calls} · ${cost}`;
}


/** Upper-bound widths for symmetry calculation. */
export const TURN_ROW_MAX_SAMPLE = formatTurnRow({
  inputTokens: 999_900,
  outputTokens: 999_900,
  callsCount: 99,
  lastToolEmoji: "🔴",
  costUsd: 99.999,
  isEstimate: true,
});

// ─── Footer context reference (pi_chimu pattern) ──────────────────────────────
// Avoids WeakMap ctx-identity issues: event ctx !== session ctx in setFooter closure.
let footerCtx: ExtensionContext | null = null;
let tuiRef: any = null;

// Safe default at module scope — no import-time I/O. Real config loads on session_start.
let _cfg = DEFAULT_WEB_CONFIG;
export function reloadCfg() { try { _cfg = loadWebConfig(); } catch {} }

const FOOTER_INDENT = 2;

function padBetween(left: string, right: string, totalWidth: number): string {
  const inner = totalWidth - 2 * FOOTER_INDENT;
  return " ".repeat(Math.max(1, inner - visibleWidth(left) - visibleWidth(right)));
}

function indent(s: string): string {
  return " ".repeat(FOOTER_INDENT) + s + " ".repeat(FOOTER_INDENT);
}

function thinkEmoji(level: string): string {
  if (level === "off")     return "🫥";
  if (level === "minimal") return "🙂";
  if (level === "low")     return "🧩";
  if (level === "medium")  return "🧠";
  if (level === "high")    return "🧠🔥";
  if (level === "xhigh")   return "🧠⚡";
  return "🧠";
}

export type ThinkingTier = "free" | "pro" | "team" | "paid" | "all";

export interface ModelProviderEntry {
  emoji: string;
  thinkingTiers: ThinkingTier[];
}

export function isThinkingVisible(args: {
  reasoning: boolean;
  provider: string;
  userTier: Exclude<ThinkingTier, "all">;
  map: Record<string, ModelProviderEntry>;
}): boolean {
  if (!args.reasoning) return false;
  const entry = args.map[args.provider];
  if (!entry) return true; // unknown provider: trust pi
  if (entry.thinkingTiers.includes("all")) return true;
  return entry.thinkingTiers.includes(args.userTier);
}

const BAR_W = 20;
const LABEL_POS = 8;
const ANSI_RESET = "\x1b[0m";
const ANSI_WHITE_FG = "\x1b[38;2;255;255;255m";
const ANSI_DARK_BG  = "\x1b[48;2;42;26;56m";

function barCellBg(pos: number): string {
  const t = pos / (BAR_W - 1);
  const r = Math.round(200 + (255 - 200) * t);
  const g = Math.round(255 + (68  - 255) * t);
  const b = Math.round(0   + (102 - 0)   * t);
  return `\x1b[48;2;${r};${g};${b}m`;
}

function ctxBar(pct: number): string {
  const p     = Math.max(0, Math.min(100, Math.round(pct)));
  const fill  = Math.round(p / 100 * BAR_W);
  const label = `${p}%`;
  let out = "[";
  for (let pos = 0; pos < BAR_W; pos++) {
    const filled   = pos < fill;
    const labelIdx = pos - LABEL_POS;
    const isLabel  = labelIdx >= 0 && labelIdx < label.length;
    const bg   = filled ? barCellBg(pos) : ANSI_DARK_BG;
    const char = isLabel ? label[labelIdx]! : " ";
    const fg   = isLabel ? ANSI_WHITE_FG : "";
    out += bg + fg + char + ANSI_RESET;
  }
  return out + "]";
}

export function registerFooter(pi: ExtensionAPI): void {
  const getThinkingLevel = (): string => (pi as any).getThinkingLevel?.() ?? "off";

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    reloadCfg();

    footerCtx = ctx;
    const state = getFridayState(ctx);

    // Reset per-turn metrics on new session
    state.turnInputTokens = undefined;
    state.turnOutputTokens = undefined;
    state.turnCallsCount = undefined;
    state.turnLastToolEmoji = undefined;
    state.turnCostUsd = undefined;
    state.turnCost = 0;
    state.turnTokenIn = 0;
    state.turnTokenOut = 0;
    state.turnToolCount = 0;
    state.turnHasCompleted = false;
    state.lastTool = "none";

    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;
      state.requestRenderFooter = () => tui.requestRender();

      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number) {
          const state = getFridayState(footerCtx ?? ctx);

          const modelId   = ctx.model?.id ?? "no-model";
          const provider  = ctx.model?.provider ?? "";
          const supportsThinking = (ctx.model as any)?.reasoning ?? false;
          const provName = provider.toLowerCase();
          const userTier = (_cfg.models.userTiers?.[provName] as any) ?? "free";
          const visible = isThinkingVisible({
            reasoning: supportsThinking,
            provider: provName,
            userTier,
            map: _cfg.models.providers as any,
          });

          const modelEmoji    = providerEmoji(provider, modelId);
          const thinkLevel    = getThinkingLevel();
          const thinkEmojiStr = thinkEmoji(thinkLevel);

          const gitBranch = footerData.getGitBranch() ?? "main";

          const thinkPart = !visible
            ? theme.fg("dim", "🫥  n/a")
            : thinkLevel === "off"
              ? theme.fg("dim", "🫥  off")
              : theme.fg("muted", `${thinkEmojiStr}  `) + theme.fg("text", thinkLevel);

          const ctxUsage  = ctx.getContextUsage();
          const ctxPct    = Math.round(ctxUsage?.percent ?? 0);
          const ctxUsed   = ctxUsage?.tokens ?? 0;
          const ctxTotal  = ctx.model?.contextWindow ?? ctxUsage?.contextWindow ?? 0;

          const line1Left =
            theme.fg("text", `${modelEmoji} `) +
            theme.fg("text", modelDisplayName(modelId)) +
            theme.fg("dim", "  │  ") +
            thinkPart;

          const ctxHeader =
            theme.fg("dim", "╠═[") +
            theme.fg("muted", "CTX · ｺﾝﾃｷｽﾄ") +
            theme.fg("dim", "]═ ");
          const ctxBody =
            ctxBar(ctxPct) +
            theme.fg("dim", "  ") +
            theme.fg("muted", formatTokenCount(ctxUsed)) +
            theme.fg("dim", "/") +
            theme.fg("muted", formatTokenCount(ctxTotal));

          const turnHeader =
            theme.fg("dim", "╠═[") +
            theme.fg("accent", "TURN · ﾀｰﾝ") +
            theme.fg("dim", "]═ ");
          const turnBody = formatTurnRow({
            inputTokens: state.turnInputTokens,
            outputTokens: state.turnOutputTokens,
            callsCount: state.turnCallsCount,
            lastToolEmoji: state.turnLastToolEmoji,
            costUsd: state.turnCostUsd,
            isEstimate: state.turnCostIsEstimate ?? false,
          });

          // Compute shared right width from PLAIN samples (no theme colours)
          const ROW1_RIGHT_PLAIN = `╠═[CTX · ｺﾝﾃｷｽﾄ]═ ${"[".padEnd(21) + "]"}  ${formatTokenCount(999_900_000)}/${formatTokenCount(999_900_000)}`;
          const ROW2_RIGHT_PLAIN = `╠═[TURN · ﾀｰﾝ]═ ${TURN_ROW_MAX_SAMPLE}`;
          const sharedRightWidth = Math.max(visibleWidth(ROW1_RIGHT_PLAIN), visibleWidth(ROW2_RIGHT_PLAIN));

          // Right-pad styled blocks to shared width (so both ╠═ start at same column)
          const ctxRight  = padToWidth(ctxHeader + ctxBody, sharedRightWidth);
          const turnRight = padToWidth(turnHeader + theme.fg("muted", turnBody), sharedRightWidth);

          const line1Raw = line1Left + padBetween(line1Left, ctxRight, width) + ctxRight;
          const line1    = truncateToWidth(indent(line1Raw), width, "");

          // ── Line 2: ⎇ branch  │  🔧 tool  ···  ↑in ↓out · 🔧N · 💰$X ──

          const gitDirty = readGitDirty(ctx.cwd || process.cwd());
          const branchDisplay =
            theme.fg("dim", "⎇  ") +
            theme.fg("text", gitBranch) +
            (formatGitDirty(gitDirty)
              ? theme.fg("dim", " [") +
                (gitDirty.staged > 0 ? theme.fg("success" as any, `+${gitDirty.staged}`) : "") +
                (gitDirty.staged > 0 && (gitDirty.modified > 0 || gitDirty.untracked > 0) ? theme.fg("dim", " ") : "") +
                (gitDirty.modified > 0 ? theme.fg("warning", `~${gitDirty.modified}`) : "") +
                (gitDirty.modified > 0 && gitDirty.untracked > 0 ? theme.fg("dim", " ") : "") +
                (gitDirty.untracked > 0 ? theme.fg("error", `!${gitDirty.untracked}`) : "") +
                theme.fg("dim", "]")
              : "");

          const line2Left = branchDisplay;

          const line2Raw = line2Left + padBetween(line2Left, turnRight, width) + turnRight;
          const line2    = truncateToWidth(indent(line2Raw), width, "");

          return [line1, line2];
        },
      };
    });
  });

  // Reset turn counters when agent starts a new response
  pi.on("before_agent_start", (_event, ctx) => {
    const ctxRef = footerCtx ?? ctx;
    const state = getFridayState(ctxRef);
    state.turnInputTokens = undefined;
    state.turnOutputTokens = undefined;
    state.turnCallsCount = undefined;
    state.turnLastToolEmoji = undefined;
    state.turnCostUsd = undefined;
    state.turnCost = 0;
    state.turnTokenIn = 0;
    state.turnTokenOut = 0;
    state.turnToolCount = 0;
    state.turnHasCompleted = false;
    state.lastTool = "none";
    tuiRef?.requestRender();
  });

  // Update usage from assistant turn_end message
  pi.on("turn_end", (event, ctx) => {
    const ctxRef = footerCtx ?? ctx;
    const state = getFridayState(ctxRef);
    const msg = (event as any).message;
    if (msg?.role === "assistant" && msg?.usage) {
      const input = msg.usage.input;
      const output = msg.usage.output;
      const cacheRead = (msg.usage as any).cache_read_input_tokens ?? 0;
      const cacheWrite = (msg.usage as any).cache_creation_input_tokens ?? 0;

      state.turnInputTokens = typeof input === "number" ? input : undefined;
      state.turnOutputTokens = typeof output === "number" ? output : undefined;
      if (typeof input === "number") state.turnTokenIn = input;
      if (typeof output === "number") state.turnTokenOut = output;

      const provider = (ctxRef.model?.provider ?? "").toLowerCase();
      const fullId = ctxRef.model?.id ?? "";
      const model = fullId.includes("/") ? fullId.split("/").slice(1).join("/") : fullId;

      if (typeof input === "number" && typeof output === "number" && model) {
        const estimate = estimateCost(model, {
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
        });
        state.turnCostUsd = estimate?.cost;
        state.turnCostIsEstimate = true;
        state.turnCost = estimate?.cost ?? 0;

        if (provider) {
          recordUsage(provider, model, {
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead > 0 ? cacheRead : undefined,
            cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
            costUsd: estimate?.cost,
          });
        }
      }
      state.turnHasCompleted = true;
    }
    tuiRef?.requestRender();
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const ctxRef = footerCtx ?? ctx;
    const state = getFridayState(ctxRef);
    state.turnCallsCount = (state.turnCallsCount ?? 0) + 1;
    state.turnLastToolEmoji = toolEmoji(event.toolName);
    state.turnToolCount += 1;
    state.lastTool = event.toolName;
    tuiRef?.requestRender();
  });

  pi.on("agent_end", (_event, _ctx) => {
    tuiRef?.requestRender();
  });
}

export default registerFooter;
