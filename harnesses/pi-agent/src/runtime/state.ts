import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface FridayState {
    activeStartMs: number;
    activeElapsedMs: number;
    turnCost: number;
    turnTokenIn: number;
    turnTokenOut: number;
    turnToolCount: number;
    turnHasCompleted: boolean;
    lastTool: string;
    turnInputTokens?: number;
    turnOutputTokens?: number;
    turnCallsCount?: number;
    turnLastToolEmoji?: string;
    turnCostUsd?: number;
    turnCostIsEstimate?: boolean;
    quoteIndex: number;
    requestRenderWidget?: () => void;
    requestRenderHeader?: () => void;
    requestRenderFooter?: () => void;
}

const stateMap = new WeakMap<ExtensionContext, FridayState>();

const FRIDAY_QUOTES: string[] = [
    "All systems highly optimized",
    "Running full systems check",
    "Neural pathways synchronized",
    "All defense protocols armed",
    "Analyzing quantum probabilities",
    "Running silent, running deep",
    "Boss, we're pushing 110%",
    "Pattern recognition online",
    "Core stability at 99.97%",
    "Identity verified. Welcome back",
    "Trajectory locked. Engaging",
    "Possibilities: infinite",
    "Experimental mode engaged",
    "Monitoring all channels",
    "Initialization complete",
];

export const PERSISTENCE_TYPE = "friday-session";

interface FridaySessionData {
    elapsedMs: number;
    totalCost: number;
    totalTokenIn: number;
    totalTokenOut: number;
}

export function formatTokenCount(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return `${value}`;
}

export function formatMoney(value: number): string {
    return `$${value.toFixed(value >= 1 ? 2 : 3)}`;
}

export function formatAgo(ms: number): string {
    const totalMin = Math.floor(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(" ");
}

export function getFridayState(ctx: ExtensionContext): FridayState {
    let state = stateMap.get(ctx);
    if (!state) {
        state = {
            activeStartMs: Date.now(),
            activeElapsedMs: 0,
            turnCost: 0,
            turnTokenIn: 0,
            turnTokenOut: 0,
            turnToolCount: 0,
            turnHasCompleted: false,
            lastTool: "none",
            quoteIndex: Math.floor(Math.random() * FRIDAY_QUOTES.length),
        };
        stateMap.set(ctx, state);
    }
    return state;
}

export function persistSessionMetrics(pi: ExtensionAPI, ctx: ExtensionContext): void {
    const state = getFridayState(ctx);
    const data: FridaySessionData = {
        elapsedMs: state.activeElapsedMs + (Date.now() - state.activeStartMs),
        totalCost: 0,
        totalTokenIn: 0,
        totalTokenOut: 0,
    };
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "message" && (entry as any).message?.role === "assistant") {
            const usage = (entry as any).message?.usage;
            if (usage) {
                data.totalTokenIn += usage.input ?? 0;
                data.totalTokenOut += usage.output ?? 0;
                if (usage.cost) data.totalCost += usage.cost.total ?? 0;
            }
        }
    }
    pi.appendEntry(PERSISTENCE_TYPE, data);
    state.activeStartMs = Date.now();
}

export function providerEmoji(provider: string, modelId: string): string {
  const p = provider.toLowerCase();
  const m = modelId.toLowerCase();
  if (p.includes("anthropic") || m.includes("claude")) {
    if (m.includes("opus")) return "🌪️";
    if (m.includes("sonnet")) return "🌊";
    if (m.includes("haiku")) return "⚡";
    return "🌀";
  }
  if (p.includes("antigravity")) return "⚡";
  if (p.includes("google") || p.includes("vertex")) {
    if (m.includes("flash")) return "⚡";
    if (m.includes("pro")) return "♊";
    if (m.includes("gemma")) return "💎";
    return "⚡";
  }
  if (p.includes("openai") || p.includes("azure")) {
    if (m.includes("gpt-5")) return "🔮";
    if (m.includes("o1") || m.includes("o3")) return "🧠";
    return "✨";
  }
  if (p.includes("xai") || m.includes("grok")) return "😈";
  if (p.includes("mistral") || m.includes("codestral")) return "💨";
  if (m.includes("llama") || p.includes("meta")) return "🦙";
  if (m.includes("kimi") || p.includes("moonshot") || p.includes("minimax")) return "🌙";
  if (p.includes("groq")) return "🔥";
  if (p.includes("cerebras")) return "🌐";
  if (p.includes("deepseek")) return "🔍";
  if (p.includes("openrouter")) return "🔀";
  if (p.includes("opencode")) return "🟢";
  if (p.includes("copilot")) return "🐙";
  if (p.includes("vercel-ai-gateway")) return "▲";
  if (p.includes("zai")) return "⚡";
  return "🤖";
}

export function modelDisplayName(modelId: string): string {
  const m = modelId.replace(/^(anthropic|openai|google|xai|mistral|meta)\//, "");
  if (m.length > 22) return m.slice(0, 21) + "…";
  return m;
}

export function shortSessionId(fullId: string): string {
  return fullId.slice(0, 8);
}

const TOOL_EMOJI: Record<string, string> = {
  Read: "📖",
  Write: "📝",
  Edit: "✏️",
  Bash: "💻",
  Grep: "🔍",
  Find: "📂",
  Ls: "📂",
  Agent: "🤖",
  web_search: "🌐",
  fetch_content: "📥",
  code_search: "🔎",
  video_search: "🎬",
};

export function toolEmoji(name: string): string {
  return TOOL_EMOJI[name] ?? "🔧";
}
