import type { FetchContentConfig } from "../types.ts";
import { hashRequest } from "../util/hash.ts";

export interface FetchContentArgs {
  urls: string[];
  mode?: "extract" | "crawl" | "map";
  format?: "markdown" | "text";
}

export interface NormalizedFetchContentRequest {
  urls: string[];
  mode: "extract" | "crawl" | "map";
  format: "markdown" | "text";
}

export interface FetchContentItem {
  url: string;
  title?: string;
  content?: string;
}

export interface FetchProviderResult {
  results: FetchContentItem[];
  metadata: {
    provider: string;
    latencyMs: number;
    unitsUsed?: number;
    tokensInput?: number;
    tokensOutput?: number;
  };
}

export interface FetchContentPublicResult {
  results: FetchContentItem[];
}

export interface FetchContentRuntime {
  config: { fetchContent: FetchContentConfig };
  cache: {
    getFetchContent(key: string): FetchContentPublicResult | undefined;
    setFetchContent(key: string, value: FetchContentPublicResult): void;
  };
  db: {
    recordFetchContent(request: NormalizedFetchContentRequest, result: FetchProviderResult): Promise<void>;
  };
  usage: {
    recordFromFetch(metadata: FetchProviderResult["metadata"]): Promise<void>;
  };
  providers: {
    fetchWithFallback(request: NormalizedFetchContentRequest): Promise<FetchProviderResult>;
  };
}

export function normalizeFetchContentArgs(args: FetchContentArgs, config: FetchContentConfig): NormalizedFetchContentRequest {
  return {
    urls: args.urls,
    mode: args.mode ?? "extract",
    format: args.format ?? config.format,
  };
}

export function hashFetchContentRequest(request: NormalizedFetchContentRequest): string {
  return hashRequest({
    urls: request.urls,
    mode: request.mode,
    format: request.format,
  });
}

export function toPublicFetchContentItem(item: FetchContentItem, mode: "extract" | "crawl" | "map"): FetchContentItem {
  if (mode === "map") {
    return { url: item.url, title: item.title };
  }
  return { url: item.url, title: item.title, content: item.content };
}

export async function executeFetchContentTool(args: FetchContentArgs, runtime: FetchContentRuntime): Promise<FetchContentPublicResult> {
  const request = normalizeFetchContentArgs(args, runtime.config.fetchContent);
  const cacheKey = hashFetchContentRequest(request);
  const cached = runtime.cache.getFetchContent(cacheKey);
  if (cached) return cached;

  const result = await runtime.providers.fetchWithFallback(request);
  const publicResult: FetchContentPublicResult = {
    results: result.results.map((item) => toPublicFetchContentItem(item, request.mode)),
  };

  runtime.cache.setFetchContent(cacheKey, publicResult);
  void runtime.db.recordFetchContent(request, result);
  void runtime.usage.recordFromFetch(result.metadata);

  return publicResult;
}
