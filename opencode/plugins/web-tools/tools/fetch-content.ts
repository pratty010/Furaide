import type { FetchContentConfig, ResultMetadata } from "../types.ts";
import { hashRequest } from "../util/hash.ts";
import { errorSink } from "../util/error-sink.ts";
import { markUntrusted, validateUrls } from "../util/validate.ts";

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
  _untrusted?: true;
}

export interface FetchProviderResult {
  results: FetchContentItem[];
  metadata: ResultMetadata;
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
  recordWithBudget(provider: string, metadata: { unitsUsed?: number; tokensInput?: number; tokensOutput?: number; estimatedCostUsd?: number }): Promise<string | null>;
}

export function normalizeFetchContentArgs(args: FetchContentArgs, config: FetchContentConfig): NormalizedFetchContentRequest {
  const urls = validateUrls(args.urls);
  return {
    urls,
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
    return markUntrusted({ url: item.url, title: item.title }, []);
  }
  return markUntrusted({ url: item.url, title: item.title, content: item.content }, ["content"]);
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
  runtime.db.recordFetchContent(request, result).catch(errorSink("fetch_content record"));
  const preamble = await runtime.recordWithBudget(result.metadata.provider, result.metadata);

  if (preamble) (publicResult as Record<string, unknown>)._warning = preamble;

  return publicResult;
}
