export type WebProvider = "gemini" | "brave" | "tavily";

export interface WebSearchConfig {
  defaultProvider: WebProvider;
  primaryFallbackOrder: WebProvider[];
  reserveFallbackOrder: WebProvider[];
  count: number;
  freshness: "pd" | "pw" | "pm" | "py";
  rawContent: boolean;
}

export interface FetchContentConfig {
  defaultProvider: "gemini" | "tavily";
  primaryFallbackOrder: Array<"gemini" | "tavily">;
  reserveFallbackOrder: Array<"gemini" | "tavily">;
  format: "markdown" | "text";
}

export interface MapsSearchConfig {
  defaultProvider: "gemini";
  count: number;
}

export interface CacheConfig {
  syncIntervalMs: number;
  ttl: {
    webSearchMs: number;
    fetchContentMs: number;
  };
}

export interface BudgetConfig {
  geminiUsd: number;
  braveRequests: number;
  tavilyCredits: number;
}

export interface WebToolsConfig {
  webSearch: WebSearchConfig;
  fetchContent: FetchContentConfig;
  mapsSearch: MapsSearchConfig;
  cache: CacheConfig;
  budgets: BudgetConfig;
}

export interface UsageRecord {
  provider: WebProvider;
  unitsUsed: number;
  estimatedCostUsd: number;
  month: string;
  tokensInput?: number;
  tokensOutput?: number;
}

export interface UsageSnapshot {
  provider: string;
  month: string;
  calls: number;
  units_used: number;
  estimated_cost_usd: number;
  tokens_input: number;
  tokens_output: number;
  warning_80_shown: number;
  warning_90_shown: number;
  budget_exceeded_shown: number;
  suppressed: number;
  last_call_at: string | null;
}
