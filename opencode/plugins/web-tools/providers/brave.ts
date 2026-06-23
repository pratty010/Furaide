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

export interface BraveSearchWebArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  rawContent?: boolean;
}

const BRAVE_BASE_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_TIMEOUT_MS = 15_000;
const BRAVE_CLAMP_MAX = 20;
const SNIPPET_MAX = 500;

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > BRAVE_CLAMP_MAX) return BRAVE_CLAMP_MAX;
  return n;
}

function buildHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("X-Subscription-Token", apiKey);
  return headers;
}

interface BraveErrorPayload {
  status: number;
  bodyPreview: string;
}

async function safeReadErrorPayload(res: Response): Promise<BraveErrorPayload> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  return { status: res.status, bodyPreview: truncateErrorBody(body) };
}

export async function searchWeb(args: BraveSearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const safeQuery = validateQuery(args.query);
  const count = clampCount(args.count, 5);

  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error("Brave web_search requires BRAVE_API_KEY");

  const url = new URL(BRAVE_BASE_URL);
  url.searchParams.set("q", safeQuery);
  url.searchParams.set("count", String(count));
  if (args.freshness) {
    url.searchParams.set("freshness", args.freshness);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(BRAVE_TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new Error(`Brave search network error: ${truncateErrorBody(e?.message ?? String(e))}`);
  }

  if (!res.ok) {
    const { status, bodyPreview } = await safeReadErrorPayload(res);
    throw new Error(`Brave search ${status}: ${bodyPreview}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error("Brave search failed: malformed JSON response");
  }

  const raw = data?.web?.results ?? data?.results ?? [];

  return {
    results: raw.slice(0, BRAVE_CLAMP_MAX).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.description ?? r.snippet ?? "").slice(0, SNIPPET_MAX),
      published: r.age ?? r.page_age,
      score: r.score,
    })),
    metadata: {
      provider: "brave" as WebProvider,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
    },
  };
}
