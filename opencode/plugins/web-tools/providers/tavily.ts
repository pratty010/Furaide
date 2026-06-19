import { isSafePublicUrl, truncateErrorBody, validateQuery } from "../util/validate.ts";
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

const TAVILY_BASE_URL = "https://api.tavily.com";
const TAVILY_TIMEOUT_MS = 30_000;
const TAVILY_CLAMP_MAX = 20;
const TAVILY_MAX_URLS = 5;
const SNIPPET_MAX = 500;

const FRESHNESS_TO_TAVILY_DAYS: Record<"pd" | "pw" | "pm" | "py", number> = {
  pd: 1,
  pw: 7,
  pm: 30,
  py: 365,
};

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > TAVILY_CLAMP_MAX) return TAVILY_CLAMP_MAX;
  return n;
}

function buildHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${apiKey}`);
  return headers;
}

interface TavilyErrorPayload {
  status: number;
  bodyPreview: string;
}

async function safeReadErrorPayload(res: Response): Promise<TavilyErrorPayload> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  return { status: res.status, bodyPreview: truncateErrorBody(body) };
}

function validateUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) throw new Error("Tavily fetchContent requires urls to be an array");
  if (urls.length === 0) throw new Error("Tavily fetchContent requires at least one URL");
  if (urls.length > TAVILY_MAX_URLS) {
    throw new Error(`Tavily fetchContent accepts at most ${TAVILY_MAX_URLS} URLs (got ${urls.length})`);
  }
  const validated: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const safe = isSafePublicUrl(String(urls[i] ?? ""));
    if (!safe.ok) throw new Error(`Tavily URL[${i}] rejected: ${safe.reason}`);
    validated.push(safe.url.toString());
  }
  return validated;
}

async function tavilyPost(apiKey: string, path: string, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${TAVILY_BASE_URL}${path}`, {
      method: "POST",
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(`Tavily ${path} network error: ${truncateErrorBody(e?.message ?? String(e))}`);
  }

  if (!res.ok) {
    const { status, bodyPreview } = await safeReadErrorPayload(res);
    throw new Error(`Tavily ${path} ${status}: ${bodyPreview}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Tavily ${path} failed: malformed JSON response`);
  }
  return data;
}

export async function searchWeb(args: TavilySearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const safeQuery = validateQuery(args.query);
  const count = clampCount(args.count, 5);

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Tavily web_search requires TAVILY_API_KEY");

  const body: Record<string, unknown> = {
    query: safeQuery,
    max_results: count,
    topic: "general",
    include_answer: false,
  };
  if (args.freshness) {
    body.days = FRESHNESS_TO_TAVILY_DAYS[args.freshness];
  }

  const data = await tavilyPost(apiKey, "/search", body);
  const raw = data?.results ?? [];

  return {
    results: raw.slice(0, TAVILY_CLAMP_MAX).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? r.snippet ?? "").slice(0, SNIPPET_MAX),
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
  const validatedUrls = validateUrls(args.urls);

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error(`Tavily ${mode} requires TAVILY_API_KEY`);

  if (mode === "extract") {
    const data = await tavilyPost(apiKey, "/extract", {
      urls: validatedUrls,
      format: args.format ?? "markdown",
    });
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

  if (mode === "crawl") {
    const format = args.format ?? "markdown";
    const merged: Array<{ url: string; title?: string; content?: string }> = [];
    for (const seedUrl of validatedUrls) {
      const data = await tavilyPost(apiKey, "/crawl", {
        url: seedUrl,
        max_depth: 2,
        format,
      });
      const raw = data?.results ?? [];
      for (const r of raw) {
        merged.push({
          url: r.url ?? "",
          title: r.title,
          content: r.raw_content ?? r.content,
        });
      }
    }
    return {
      results: merged,
      metadata: {
        provider: "tavily" as WebProvider,
        latencyMs: Math.round(performance.now() - start),
        unitsUsed: validatedUrls.length,
      },
    };
  }

  if (mode === "map") {
    const merged: Array<{ url: string; title?: string; content?: string }> = [];
    for (const seedUrl of validatedUrls) {
      const data = await tavilyPost(apiKey, "/map", { url: seedUrl });
      const raw = data?.results ?? [];
      for (const r of raw) {
        merged.push({ url: r.url ?? "", title: r.title });
      }
    }
    return {
      results: merged,
      metadata: {
        provider: "tavily" as WebProvider,
        latencyMs: Math.round(performance.now() - start),
        unitsUsed: validatedUrls.length,
      },
    };
  }

  throw new Error(`Tavily fetchContent does not support mode '${mode}'`);
}
