import type { WebSearchConfig, ResultMetadata } from "../types.ts";
import { hashRequest } from "../util/hash.ts";
import { errorSink } from "../util/error-sink.ts";

export interface WebSearchArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  raw_content?: boolean;
}

export interface NormalizedWebSearchRequest {
  query: string;
  count: number;
  freshness: "pd" | "pw" | "pm" | "py";
  rawContent: boolean;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  published?: string;
  score?: number;
  content?: string;
}

export interface SearchProviderResult {
  results: SearchResultItem[];
  metadata: ResultMetadata;
}

export interface WebSearchPublicResult {
  results: SearchResultItem[];
}

export interface WebSearchRuntime {
  config: { webSearch: WebSearchConfig };
  cache: {
    getWebSearch(key: string): WebSearchPublicResult | undefined;
    setWebSearch(key: string, value: WebSearchPublicResult): void;
  };
  db: {
    recordWebSearch(request: NormalizedWebSearchRequest, result: SearchProviderResult): Promise<void>;
  };
  usage: {
    recordFromSearch(metadata: SearchProviderResult["metadata"]): Promise<void>;
  };
  providers: {
    searchWithFallback(request: NormalizedWebSearchRequest): Promise<SearchProviderResult>;
  };
  recordWithBudget(provider: string, metadata: { unitsUsed?: number; tokensInput?: number; tokensOutput?: number; estimatedCostUsd?: number }): Promise<string | null>;
}

export function normalizeWebSearchArgs(args: WebSearchArgs, config: WebSearchConfig): NormalizedWebSearchRequest {
  return {
    query: args.query,
    count: args.count ?? config.count,
    freshness: args.freshness ?? config.freshness,
    rawContent: args.raw_content ?? config.rawContent,
  };
}

export function hashWebSearchRequest(request: NormalizedWebSearchRequest): string {
  return hashRequest({
    query: request.query,
    count: request.count,
    freshness: request.freshness,
    rawContent: request.rawContent,
  });
}

export function toPublicSearchResult(r: SearchResultItem): SearchResultItem {
  const result: SearchResultItem = { title: r.title, url: r.url, snippet: r.snippet };
  if (r.published !== undefined) result.published = r.published;
  if (r.score !== undefined) result.score = r.score;
  if (r.content !== undefined) result.content = r.content;
  return result;
}

export async function executeWebSearchTool(args: WebSearchArgs, runtime: WebSearchRuntime): Promise<WebSearchPublicResult> {
  const request = normalizeWebSearchArgs(args, runtime.config.webSearch);
  const cacheKey = hashWebSearchRequest(request);
  const cached = runtime.cache.getWebSearch(cacheKey);
  if (cached) return cached;

  const result = await runtime.providers.searchWithFallback(request);
  const publicResult: WebSearchPublicResult = {
    results: result.results.map(toPublicSearchResult),
  };

  runtime.cache.setWebSearch(cacheKey, publicResult);
  runtime.db.recordWebSearch(request, result).catch(errorSink("web_search record"));
  const preamble = await runtime.recordWithBudget(result.metadata.provider, result.metadata);

  if (preamble) (publicResult as Record<string, unknown>)._warning = preamble;

  return publicResult;
}
