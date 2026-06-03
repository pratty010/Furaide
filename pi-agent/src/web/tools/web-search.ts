import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { geminiSearch } from "../providers/gemini.ts";
import { braveAvailable, braveSearch } from "../providers/brave.ts";
import { tavilyAvailable, tavilySearch } from "../providers/tavily.ts";
import { exaSearch } from "../providers/exa.ts";
import { serperSearch } from "../providers/serper.ts";
import type { WebConfig } from "../config/schema.ts";
import type { WebResult } from "../types.ts";
import type { KnowledgeDB } from "../runtime/db.ts";
import type { SemanticCache } from "../runtime/semantic-cache.ts";
import { normaliseQuery } from "../runtime/query-normalise.ts";
import { setLastCacheOutcome } from "../../runtime/last-cache-outcome.ts";

type ProviderName = "gemini" | "brave" | "tavily" | "exa" | "serper";

export interface WebSearchArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  includeDomains?: string[];
  excludeDomains?: string[];
  provider?: ProviderName;
  force?: boolean;
}

export interface WebSearchDeps {
  db: KnowledgeDB;
  semanticCache: SemanticCache;
  cfg: WebConfig;
  providers?: Partial<Record<ProviderName, (args: WebSearchArgs) => Promise<WebResult[]>>>;
}

export interface WebSearchResponse {
  results: WebResult[];
  answer?: string;
  provider: string;
  cached: boolean | "soft";
  similarity?: number;
}

function stableNormalizeArgs(args: WebSearchArgs): Record<string, unknown> {
  return {
    query: args.query.trim(),
    count: args.count ?? null,
    freshness: args.freshness ?? null,
    includeDomains: [...(args.includeDomains ?? [])].sort(),
    excludeDomains: [...(args.excludeDomains ?? [])].sort(),
    provider: args.provider ?? null,
    force: args.force ?? false,
  };
}

function hashQuery(tool: string, args: WebSearchArgs): string {
  const normalized = stableNormalizeArgs(args);
  return createHash("sha256")
    .update(`${tool}:${JSON.stringify(normalized)}`)
    .digest("hex");
}

function monthKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

function effectiveOrder(args: WebSearchArgs, cfg: WebConfig): ProviderName[] {
  const isEnabled = (provider: ProviderName): boolean => cfg.providers[provider]?.enabled === true;

  if (args.provider) {
    return isEnabled(args.provider) ? [args.provider] : [];
  }

  const defaultProvider = cfg.webSearch.defaultProvider as ProviderName;
  const primary = cfg.webSearch.primaryFallbackOrder as ProviderName[];
  const reserve = cfg.webSearch.useReserveProviders
    ? (cfg.webSearch.reserveFallbackOrder as ProviderName[])
    : [];

  const seen = new Set<ProviderName>();
  const out: ProviderName[] = [];
  const pushIfEnabled = (provider: ProviderName) => {
    if (!seen.has(provider) && isEnabled(provider)) {
      seen.add(provider);
      out.push(provider);
    }
  };

  pushIfEnabled(defaultProvider);
  for (const provider of primary) pushIfEnabled(provider);
  for (const provider of reserve) pushIfEnabled(provider);

  return out;
}

function normalizeFreshnessForGeminiAndTavily(f?: "pd" | "pw" | "pm" | "py"): string | undefined {
  switch (f) {
    case "pd":
      return "day";
    case "pw":
      return "week";
    case "pm":
      return "month";
    case "py":
      return "year";
    default:
      return undefined;
  }
}

export async function handleWebSearch(
  args: WebSearchArgs,
  deps: WebSearchDeps,
): Promise<WebSearchResponse> {
  const { db, semanticCache, cfg } = deps;
  const now = Date.now();
  const ttl = cfg.semanticCache.ttl.web_search;
  const query = args.query;
  const normQuery = normaliseQuery(query);

  if (!args.force) {
    const hit = await semanticCache.lookup("web_search", normQuery);
    setLastCacheOutcome({
      tool: "web_search",
      outcome: hit.kind,
      similarity: (hit.kind === "hard" || hit.kind === "soft") ? hit.similarity : null,
    });
    if (
      hit.kind === "l1_hit" &&
      hit.result &&
      typeof hit.result === "object" &&
      "results" in hit.result &&
      Array.isArray((hit.result as Record<string, unknown>).results) &&
      typeof (hit.result as Record<string, unknown>).provider === "string"
    ) {
      const cachedResult = hit.result as { results: WebResult[]; provider: string; answer?: string; similarity?: number };
      return { ...cachedResult, cached: true };
    }
    if (hit.kind === "hard" || hit.kind === "soft") {
      const q = db.getQueryByHash(hit.queryHash);
      if (q) {
        const rows = db.raw
          .query<any, [string]>(`
            SELECT
              j.value AS url,
              p.title AS title,
              p.snippet AS snippet,
              p.provider AS provider,
              p.metadata AS metadata
            FROM queries q
            JOIN json_each(q.result_urls) j
            LEFT JOIN pages p ON p.url = j.value
            WHERE q.query_hash = ?
            ORDER BY j.key ASC
          `)
          .all(hit.queryHash);

        const results: WebResult[] = rows.map((r: any) => {
          let published: string | undefined;
          let score: number | undefined;
          if (r.metadata) {
            try {
              const parsed = JSON.parse(String(r.metadata)) as {
                published?: string;
                score?: number;
              };
              published = parsed.published;
              score = parsed.score;
            } catch {
              // ignore malformed metadata
            }
          }

          const provider =
            (r.provider as ProviderName | null) ??
            (q.provider as ProviderName | null) ??
            "gemini";

          return {
            title: r.title ?? "",
            url: r.url,
            snippet: r.snippet ?? "",
            provider,
            published,
            score,
          };
        });

        return {
          results,
          answer: q.answer ?? undefined,
          provider: q.provider ?? results[0]?.provider ?? "unknown",
          cached: hit.kind === "hard" ? true : "soft",
          similarity: hit.similarity,
        };
      }
    }
  } else {
    setLastCacheOutcome({ tool: "web_search", outcome: "miss", similarity: null });
  }

  const order = effectiveOrder(args, cfg);
  let selectedProvider: ProviderName | null = null;
  let selectedResults: WebResult[] = [];
  const errors: string[] = [];

  for (const provider of order) {
    if (provider === "brave" && !braveAvailable()) continue;
    if (provider === "tavily" && !tavilyAvailable()) continue;

    const fn = deps.providers?.[provider];
    if (!fn) continue;

    try {
      const results = await fn(args);
      if (results.length > 0) {
        selectedProvider = provider;
        selectedResults = results;
        break;
      }
    } catch (error: any) {
      errors.push(`${provider}: ${error?.message ?? String(error)}`);
    }
  }

  if (!selectedProvider || selectedResults.length === 0) {
    throw new Error(
      errors.length > 0
        ? `web_search: all providers failed — ${errors.join("; ")}`
        : "web_search: no enabled provider returned results",
    );
  }

  for (const result of selectedResults) {
    if (!result.url) continue;
    db.upsertPage({
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      kind: "web",
      provider: selectedProvider,
      metadata: JSON.stringify({ score: result.score, published: result.published }),
      expiresAt: now + ttl,
    });
  }

  const answer = selectedResults.find(r => typeof r.answer === "string")?.answer;
  const queryHash = hashQuery("web_search", { ...args, query: normQuery });

  const finalResult: WebSearchResponse = {
    results: selectedResults,
    answer,
    provider: selectedProvider,
    cached: false,
  };

  await semanticCache.store(
    {
      tool: "web_search",
      queryText: normQuery,
      queryHash,
      provider: selectedProvider,
      answer: answer ?? null,
      resultUrls: selectedResults.map(r => r.url).filter(Boolean),
      expiresAt: now + ttl,
    },
    query,
    finalResult
  );

  db.incrementUsage(selectedProvider, "month", monthKey(now), 1);
  db.incrementUsage(selectedProvider, "calls", monthKey(now), 1);

  return finalResult;
}

export function registerWebSearch(pi: ExtensionAPI, deps: WebSearchDeps): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web with semantic cache-first flow and tiered provider fallback.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Max results" })),
      freshness: Type.Optional(
        Type.Union([
          Type.Literal("pd"),
          Type.Literal("pw"),
          Type.Literal("pm"),
          Type.Literal("py"),
        ]),
      ),
      includeDomains: Type.Optional(Type.Array(Type.String())),
      excludeDomains: Type.Optional(Type.Array(Type.String())),
      provider: Type.Optional(
        Type.Union([
          Type.Literal("gemini"),
          Type.Literal("brave"),
          Type.Literal("tavily"),
          Type.Literal("exa"),
          Type.Literal("serper"),
        ]),
      ),
      force: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, rawArgs) {
      const args = rawArgs as WebSearchArgs;

      const merged: WebSearchArgs = {
        query: args.query,
        count: args.count ?? deps.cfg.webSearch.count,
        freshness: args.freshness ?? (deps.cfg.webSearch.freshness ?? undefined),
        includeDomains: args.includeDomains ?? deps.cfg.webSearch.includeDomains,
        excludeDomains: args.excludeDomains ?? deps.cfg.webSearch.excludeDomains,
        provider: args.provider,
        force: args.force,
      };

      const result = await handleWebSearch(merged, {
        ...deps,
        providers: {
          gemini: async (a) =>
            geminiSearch(
              a.query,
              { count: a.count, freshness: normalizeFreshnessForGeminiAndTavily(a.freshness) } as any,
              deps.cfg,
            ),
          brave: async (a) =>
            braveSearch(
              a.query,
              {
                count: a.count,
                freshness: a.freshness,
                includeSites: a.includeDomains,
                excludeSites: a.excludeDomains,
              },
              deps.cfg,
            ),
          tavily: async (a) =>
            tavilySearch(
              a.query,
              {
                maxResults: a.count,
                timeRange: normalizeFreshnessForGeminiAndTavily(a.freshness),
              },
              deps.cfg,
            ),
          exa: async (a) =>
            exaSearch(
              a.query,
              {
                count: a.count,
                freshness: a.freshness,
                includeSites: a.includeDomains,
                excludeSites: a.excludeDomains,
              },
              deps.cfg,
            ),
          serper: async (a) =>
            serperSearch(
              a.query,
              {
                count: a.count,
                freshness: a.freshness,
              },
              deps.cfg,
            ),
          ...deps.providers,
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
