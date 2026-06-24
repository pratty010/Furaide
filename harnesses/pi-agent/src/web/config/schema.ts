export type EmbedProvider = "google" | "ollama" | "openai-compat" | "local";
export type FreshnessFilter = "pd" | "pw" | "pm" | "py" | null;

export interface WebConfig {
  providers: {
    gemini:  { enabled: boolean; apiKeyEnv: string; searchModel: string; urlContextModel: string; videoModel: string };
    brave:   { enabled: boolean; apiKeyEnv: string; timeoutSec: number; resultFilter: string };
    tavily:  { enabled: boolean; apiKeyEnv: string; depth: "basic" | "advanced" };
    exa:     { enabled: boolean; apiKeyEnv: string };
    serper:  { enabled: boolean; apiKeyEnv: string };
    ctx7:    { enabled: boolean; apiKeyEnv: string | null };
    github:  { enabled: boolean };
    ytDlp:   { enabled: boolean; timeoutSec: number; cookiesFromBrowser: string | null };
  };
  webSearch: {
    defaultProvider: "gemini" | "brave" | "tavily" | "exa" | "serper";
    primaryFallbackOrder: string[];
    reserveFallbackOrder: string[];
    useReserveProviders: boolean;
    count: number;
    freshness: FreshnessFilter;
    includeDomains: string[];
    excludeDomains: string[];
  };
  fetchContent: {
    maxChars: number;
    tavily: { format: "markdown" | "text"; depth: "basic" | "advanced" };
  };
  codeSearch: { limit: number };
  videoSearch: {
    count: number;
    freshness: FreshnessFilter;
    transcript: boolean;
    transcriptLangs: string[];
    subtitleFormat: "vtt" | "srt" | "best";
    preferAutoSubs: boolean;
    maxTranscriptChars: number;
    geminiFallback: "timestamped_summary";
  };
  semanticCache: {
    enabled: boolean;
    provider: EmbedProvider;
    hardThreshold: number;
    softThreshold: number;
    ttl: { web_search: number; video_search: number; fetch_content: number };
    google:       { model: string; apiKeyEnv: string };
    ollama:       { baseUrl: string; model: string };
    openaiCompat: { baseUrl: string; model: string; apiKeyEnv: string };
    local:        { model: string };
  };
  paths: { stateRoot: string; dbFile: string };
  quotas: {
    toolProviders: Record<string, {
      source: "provider" | "local"; unit: "credits" | "usd" | "requests";
      monthLimit?: number; totalBudget?: number;
      resetDay?: number;
    }>;
    modelProviders: Record<string, {
      source: "local"; unit: "messages" | "requests" | "usd";
      rolling5hLimit: number | null; rolling1wLimit: number | null; rolling1moLimit: number | null;
      used5h: number; used1w: number; used1mo: number;
    }>;
    apiProviders: Record<string, {
      apiCostTotal: number;
      apiCostLimit: number | null;
    }>;
    apiGroups: Record<string, {
      providers: string[];
      combinedBudget: number;
      note?: string;
    }>;
  };
  models: {
    providers: Record<string, {
      emoji: string;
      thinkingTiers: ("free" | "pro" | "team" | "paid" | "all")[];
    }>;
    userTiers?: Record<string, "free" | "pro" | "team" | "paid">;
  };
  runner: { timeoutMs: number };
  timezone: string;

  // resolved at load time, not in YAML
  secrets: Record<string, string | undefined>;
}

export const DEFAULT_WEB_CONFIG: WebConfig = {
  providers: {
    gemini:  { enabled: true,  apiKeyEnv: "GEMINI_API_KEY",  searchModel: "gemini-2.5-flash", urlContextModel: "gemini-2.5-flash", videoModel: "gemini-3-flash-preview" },
    brave:   { enabled: true,  apiKeyEnv: "BRAVE_SEARCH_API_KEY", timeoutSec: 30, resultFilter: "discussions,news,query,videos,web" },
    tavily:  { enabled: true,  apiKeyEnv: "TAVILY_API_KEY", depth: "basic" },
    exa:     { enabled: true,  apiKeyEnv: "EXA_API_KEY" },
    serper:  { enabled: false, apiKeyEnv: "SERPER_API_KEY" },
    ctx7:    { enabled: true,  apiKeyEnv: "CONTEXT7_API_KEY" },
    github:  { enabled: true },
    ytDlp:   { enabled: true,  timeoutSec: 30, cookiesFromBrowser: null },
  },
  webSearch: {
    defaultProvider: "gemini",
    primaryFallbackOrder: ["gemini", "brave", "tavily"],
    reserveFallbackOrder: ["exa", "serper"],
    useReserveProviders: true,
    count: 20,
    freshness: null,
    includeDomains: [],
    excludeDomains: [],
  },
  fetchContent: {
    maxChars: 50000,
    tavily: { format: "markdown", depth: "basic" },
  },
  codeSearch: { limit: 30 },
  videoSearch: {
    count: 20,
    freshness: null,
    transcript: false,
    transcriptLangs: ["en"],
    subtitleFormat: "vtt",
    preferAutoSubs: true,
    maxTranscriptChars: 5000,
    geminiFallback: "timestamped_summary",
  },
  semanticCache: {
    enabled: true,
    provider: "google",
    hardThreshold: 0.88,
    softThreshold: 0.75,
    ttl: { web_search: 3600000, video_search: 21600000, fetch_content: 86400000 },
    google:       { model: "gemini-embedding-2-preview", apiKeyEnv: "GEMINI_API_KEY" },
    ollama:       { baseUrl: "http://localhost:11434", model: "nomic-embed-text-v2-moe" },
    openaiCompat: { baseUrl: "http://localhost:11434/v1", model: "text-embedding-3-small", apiKeyEnv: "OPENAI_API_KEY" },
    local:        { model: "Xenova/all-MiniLM-L6-v2" },
  },
  paths: {
    stateRoot: "~/.pi/agent/extensions/friday/state/web",
    dbFile:    "~/.pi/agent/extensions/friday/state/web/web.db",
  },
  quotas: {
    toolProviders: {
      brave:  { source: "provider", unit: "credits", monthLimit: 2000, resetDay: 1 },
      tavily: { source: "provider", unit: "credits", monthLimit: 1000, resetDay: 1 },
      exa:    { source: "local",    unit: "usd",     totalBudget: 20  },
      serper: { source: "local",    unit: "credits", totalBudget: 2500 },
    },
    modelProviders: {
      "openai-codex": { source: "local", unit: "messages", rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 },
      "opencode":     { source: "local", unit: "requests", rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 },
      "opencode-go":  { source: "local", unit: "requests", rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 },
    },
    apiProviders: {
      google: { apiCostTotal: 0, apiCostLimit: null },
      openai: { apiCostTotal: 0, apiCostLimit: null },
    },
    apiGroups: {},
  },
  models: {
    providers: {
      opencode:            { emoji: "🟢", thinkingTiers: ["pro", "team"] },
      "opencode-go":       { emoji: "🟢", thinkingTiers: ["pro"] },
      "github-copilot":    { emoji: "🐙", thinkingTiers: ["all"] },
      "kimi-coding":       { emoji: "🌙", thinkingTiers: ["all"] },
      zai:                 { emoji: "⚡", thinkingTiers: [] },
      "vercel-ai-gateway": { emoji: "▲", thinkingTiers: ["all"] },
    },
  },
  runner: { timeoutMs: 15000 },
  timezone: "Asia/Kolkata",
  secrets: {},
};
