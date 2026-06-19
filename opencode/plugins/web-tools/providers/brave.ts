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

export interface BraveSearchWebArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  rawContent?: boolean;
}

export async function searchWeb(args: BraveSearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const bxArgs = ["search", args.query, "--count", String(args.count ?? 5)];
  if (args.freshness) bxArgs.push("--freshness", args.freshness);

  const result = spawnSync("bx", bxArgs, {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const msg = result.error?.message ?? `exit code ${result.status}`;
    throw new Error(`Brave search failed: ${msg}`);
  }

  const data = JSON.parse(result.stdout);
  const raw = data?.web?.results ?? data?.results ?? [];

  return {
    results: raw.slice(0, 20).map((r: any) => ({
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
