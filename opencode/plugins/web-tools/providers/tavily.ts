import { spawnSync } from "node:child_process";
import { assertSafeArgv, isSafePublicUrl, sanitizeArgvValues } from "../util/validate.ts";
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

const TAVILY_TIMEOUT_MS = 30_000;
const TAVILY_MAX_BUFFER = 10 * 1024 * 1024;
const TAVILY_CLAMP_MAX = 20;

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > TAVILY_CLAMP_MAX) return TAVILY_CLAMP_MAX;
  return n;
}

function sanitizeError(message: string): string {
  return message.length > 200 ? message.slice(0, 200) + "…[truncated]" : message;
}

export async function searchWeb(args: TavilySearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const safeQuery = assertSafeArgv(args.query, "query");
  const count = clampCount(args.count, 5);
  const tvlyArgs = ["search", safeQuery, "--json", "--max-results", String(count)];
  if (args.freshness) {
    tvlyArgs.push("--time-range", sanitizeArgvValues([args.freshness], "freshness")[0]);
  }

  const result = spawnSync("tvly", tvlyArgs, {
    encoding: "utf8",
    timeout: TAVILY_TIMEOUT_MS,
    maxBuffer: TAVILY_MAX_BUFFER,
  });

  if (result.error || result.status !== 0) {
    const msg = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`Tavily search failed: ${sanitizeError(msg)}`);
  }

  let data: any;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error("Tavily search failed: malformed JSON response");
  }
  const raw = data?.results ?? [];

  return {
    results: raw.slice(0, TAVILY_CLAMP_MAX).map((r: any) => ({
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

  const validatedUrls: string[] = [];
  for (const u of args.urls) {
    const safe = isSafePublicUrl(String(u ?? ""));
    if (!safe.ok) throw new Error(`Tavily URL rejected: ${safe.reason}`);
    validatedUrls.push(safe.url.toString());
  }

  const tvlyArgs = [mode, ...sanitizeArgvValues(validatedUrls, "url"), "--json", "--format", args.format ?? "markdown"];

  const result = spawnSync("tvly", tvlyArgs, {
    encoding: "utf8",
    timeout: TAVILY_TIMEOUT_MS,
    maxBuffer: TAVILY_MAX_BUFFER,
  });

  if (result.error || result.status !== 0) {
    const msg = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`Tavily ${mode} failed: ${sanitizeError(msg)}`);
  }

  let data: any;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Tavily ${mode} failed: malformed JSON response`);
  }
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
