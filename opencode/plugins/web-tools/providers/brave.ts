import { spawnSync } from "node:child_process";
import { assertSafeArgv, sanitizeArgvValues } from "../util/validate.ts";
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

const BRAVE_TIMEOUT_MS = 15_000;
const BRAVE_MAX_BUFFER = 10 * 1024 * 1024;
const BRAVE_CLAMP_MAX = 20;

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > BRAVE_CLAMP_MAX) return BRAVE_CLAMP_MAX;
  return n;
}

function sanitizeError(message: string): string {
  return message.length > 200 ? message.slice(0, 200) + "…[truncated]" : message;
}

export async function searchWeb(args: BraveSearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const safeQuery = assertSafeArgv(args.query, "query");
  const count = clampCount(args.count, 5);
  const bxArgs = ["search", safeQuery, "--count", String(count)];
  if (args.freshness) {
    bxArgs.push("--freshness", sanitizeArgvValues([args.freshness], "freshness")[0]);
  }

  const result = spawnSync("bx", bxArgs, {
    encoding: "utf8",
    timeout: BRAVE_TIMEOUT_MS,
    maxBuffer: BRAVE_MAX_BUFFER,
  });

  if (result.error || result.status !== 0) {
    const msg = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`Brave search failed: ${sanitizeError(msg)}`);
  }

  let data: any;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error("Brave search failed: malformed JSON response");
  }
  const raw = data?.web?.results ?? data?.results ?? [];

  return {
    results: raw.slice(0, BRAVE_CLAMP_MAX).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.description ?? r.snippet ?? "").slice(0, 500),
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
