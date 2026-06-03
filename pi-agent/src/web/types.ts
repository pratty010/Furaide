export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  answer?: string;
  published?: string;
  score?: number;
  provider: "gemini" | "brave" | "tavily" | "exa" | "serper";
}

export interface FetchResult {
  url: string;
  title?: string;
  content: string;
  urls?: string[];
  pages?: FetchResult[];
  provider: "builtin" | "tavily" | "exa";
}

export interface CodeResult {
  title: string;
  url: string;
  snippet: string;
  language?: string;
  library?: string;
  provider: "ctx7" | "github";
}

export interface VideoResult {
  title: string;
  url: string;
  duration?: string;
  thumbnail?: string;
  transcript?: string;
  provider: "brave";
}

export interface ToolResponse<T> {
  results: T[];
  answer?: string;
  provider: string;
  cached: boolean | "soft";
  similarity?: number;
  meta: {
    latencyMs: number;
    usageThisMonth: Record<string, number>;
  };
}
