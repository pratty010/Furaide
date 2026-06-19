import { spawnSync } from "node:child_process";
import type { WebProvider } from "../types.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
  score?: number;
  content?: string;
}

export interface SearchProviderMetadata {
  provider: WebProvider;
  latencyMs: number;
  raw?: unknown;
  unitsUsed?: number;
  tokensInput?: number;
  tokensOutput?: number;
}

export interface SearchProviderResult {
  results: SearchResult[];
  metadata: SearchProviderMetadata;
}

export interface FetchContentResult {
  results: Array<{ url: string; title?: string; content?: string }>;
  metadata: SearchProviderMetadata;
}

export interface TavilySearchWebArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  rawContent?: boolean;
}

export interface TavilyFetchContentArgs {
  urls: string[];
  mode?: "extract" | "crawl" | "map";
  format?: "markdown" | "text";
}

export async function searchWeb(args: TavilySearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const tvlyArgs = ["search", args.query, "--json", "--max-results", String(args.count ?? 5)];
  if (args.freshness) tvlyArgs.push("--time-range", args.freshness);

  const result = spawnSync("tvly", tvlyArgs, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const msg = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`Tavily search failed: ${msg}`);
  }

  const data = JSON.parse(result.stdout);
  const raw = data?.results ?? [];

  return {
    results: raw.slice(0, 20).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? r.snippet ?? "").slice(0, 500),
      published: r.published_date,
      score: r.score,
    })),
    metadata: {
      provider: "tavily" as WebProvider,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
    },
  };
}

export async function fetchContent(args: TavilyFetchContentArgs): Promise<FetchContentResult> {
  const start = performance.now();
  const mode = args.mode ?? "extract";

  const tvlyArgs = [mode, ...args.urls, "--json", "--format", args.format ?? "markdown"];

  const result = spawnSync("tvly", tvlyArgs, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const msg = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`Tavily ${mode} failed: ${msg}`);
  }

  const data = JSON.parse(result.stdout);
  const raw = data?.results ?? [];

  return {
    results: raw.map((r: any) => ({
      url: r.url ?? "",
      title: r.title,
      content: r.raw_content ?? r.content,
    })),
    metadata: {
      provider: "tavily" as WebProvider,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
    },
  };
}
