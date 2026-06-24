import { run, binaryExists } from "../runtime/runner.ts";
import type { WebResult, FetchResult } from "../types.ts";
import type { WebConfig } from "../config/schema.ts";

export function tavilyAvailable(): boolean { return binaryExists("tvly"); }

export function tavilySearch(query: string, opts: {
  maxResults?: number; topic?: string; timeRange?: string;
}, cfg: WebConfig): WebResult[] {
  const timeRange = mapTimeRange(opts.timeRange);
  const args = ["search", query, "--json",
    "--depth", cfg.providers.tavily.depth,
    "--max-results", String(opts.maxResults ?? cfg.webSearch.count),
    "--include-answer", "basic",
  ];
  if (opts.topic) args.push("--topic", opts.topic);
  if (timeRange) args.push("--time-range", timeRange);
  const result = run("tvly", args, cfg.runner.timeoutMs);
  if (!result.ok) throw new Error(`tvly search: ${result.errorMsg}`);
  const data = result.data as any;
  const answer: string | undefined = data?.answer;
  const raw: any[] = data?.results ?? [];
  return raw.slice(0, 20).map(r => ({
    title:    r.title ?? "",
    url:      r.url ?? "",
    snippet:  (r.content ?? r.snippet ?? "").slice(0, 500),
    answer,
    published: r.published_date,
    score:     r.score,
    provider: "tavily" as const,
  }));
}

export function tavilyExtract(url: string, opts: { query?: string }, cfg: WebConfig): FetchResult {
  const args = ["extract", url, "--json", "--format", cfg.fetchContent.tavily.format,
    "--extract-depth", cfg.fetchContent.tavily.depth];
  if (opts.query) args.push("--query", opts.query);
  const result = run("tvly", args, cfg.runner.timeoutMs);
  if (!result.ok) throw new Error(`tvly extract: ${result.errorMsg}`);
  const data = result.data as any;
  const page = data?.results?.[0] ?? data;
  return {
    url, title: page?.title,
    content: (page?.raw_content ?? page?.content ?? "").slice(0, cfg.fetchContent.maxChars),
    provider: "tavily" as const,
  };
}

export function tavilyCrawl(url: string, cfg: WebConfig): FetchResult {
  const result = run("tvly", ["crawl", url, "--json"], cfg.runner.timeoutMs);
  if (!result.ok) throw new Error(`tvly crawl: ${result.errorMsg}`);
  const data = result.data as any;
  const pages: FetchResult[] = (data?.pages ?? data?.results ?? []).map((p: any) => ({
    url: p.url ?? url, title: p.title,
    content: (p.content ?? "").slice(0, cfg.fetchContent.maxChars),
    provider: "tavily" as const,
  }));
  return { url, content: "", pages, provider: "tavily" as const };
}

export function tavilyMap(url: string, cfg: WebConfig): FetchResult {
  const result = run("tvly", ["map", url, "--json"], cfg.runner.timeoutMs);
  if (!result.ok) throw new Error(`tvly map: ${result.errorMsg}`);
  const data = result.data as any;
  const urls: string[] = data?.urls ?? data?.links ?? [];
  return { url, content: "", urls, provider: "tavily" as const };
}

function mapTimeRange(timeRange?: string): string | undefined {
  if (!timeRange) return undefined;
  const map: Record<string, string> = {
    day: "d",
    week: "w",
    month: "m",
    year: "y",
  };
  return map[timeRange] ?? timeRange;
}
