import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { WebConfig } from "../config/schema.ts";
import type { FetchResult } from "../types.ts";
import type { KnowledgeDB } from "../runtime/db.ts";
import { simhash64 } from "../runtime/textsim.ts";
import { builtinFetch } from "../providers/builtin-fetch.ts";
import { geminiUrlContext } from "../providers/gemini.ts";
import { tavilyCrawl, tavilyExtract, tavilyMap } from "../providers/tavily.ts";
import { exaFetch } from "../providers/exa.ts";

type ProviderName = "builtin" | "gemini" | "tavily" | "exa";

export interface FetchContentArgs {
  url: string;
  urls?: string[];
  query?: string;
  mode?: "extract" | "crawl" | "map";
  depth?: "basic" | "advanced";
  force?: boolean;
}

type ProviderFn = () => Promise<FetchResult> | FetchResult;

export interface FetchContentDeps {
  db: KnowledgeDB;
  cfg: WebConfig;
  providers: Partial<Record<ProviderName, ProviderFn>>;
}

export type FetchContentResponse = FetchResult & { cached: boolean };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function defaultProviders(args: FetchContentArgs, cfg: WebConfig): Partial<Record<ProviderName, ProviderFn>> {
  return {
    builtin: async () => builtinFetch(args.url, cfg as any),
    gemini: async () => geminiUrlContext(args.url, cfg),
    tavily: async () => {
      if (args.mode === "crawl") return tavilyCrawl(args.url, cfg);
      if (args.mode === "map") return tavilyMap(args.url, cfg);
      return tavilyExtract(args.url, { query: args.query }, cfg);
    },
    exa: async () => {
      const pages = await exaFetch([args.url], cfg);
      if (!pages[0]) throw new Error("exa returned no content");
      return pages[0];
    },
  };
}

export async function handleFetchContent(
  args: FetchContentArgs,
  deps: FetchContentDeps,
): Promise<FetchContentResponse> {
  const mode = args.mode ?? "extract";
  const now = Date.now();

  if (mode === "crawl" || mode === "map") {
    const tavily = deps.providers.tavily;
    if (!tavily) {
      throw new Error("fetch_content: tavily provider is required for crawl/map mode");
    }
    const result = await tavily();
    return { ...result, cached: false };
  }

  if (!args.force) {
    const cached = deps.db.getPage(args.url);
    if (cached && cached.expiresAt > now && cached.body != null) {
      return {
        url: cached.url,
        title: cached.title ?? undefined,
        content: cached.body,
        provider: (cached.provider as FetchResult["provider"]) ?? "builtin",
        cached: true,
      };
    }
  }

  const order: ProviderName[] = ["builtin", "gemini", "tavily", "exa"];
  const errors: string[] = [];

  for (const providerName of order) {
    const provider = deps.providers[providerName];
    if (!provider) continue;

    try {
      const result = await provider();
      const content = (result.content ?? "").slice(0, deps.cfg.fetchContent.maxChars);
      deps.db.upsertPage({
        url: result.url || args.url,
        title: result.title,
        body: content,
        kind: "fetch",
        provider: result.provider,
        simhash: simhash64(content).toString(16).padStart(16, "0"),
        contentHash: sha256(content),
        fetchedAt: now,
        expiresAt: now + deps.cfg.semanticCache.ttl.fetch_content,
      });

      return {
        ...result,
        url: result.url || args.url,
        content,
        cached: false,
      };
    } catch (error: any) {
      errors.push(`${providerName}: ${error?.message ?? String(error)}`);
    }
  }

  throw new Error(
    errors.length > 0
      ? `fetch_content: all providers failed — ${errors.join("; ")}`
      : "fetch_content: no provider available",
  );
}

export function registerFetchContent(
  pi: ExtensionAPI,
  deps: Omit<FetchContentDeps, "providers"> & {
    providers?: Partial<Record<ProviderName, ProviderFn>>;
  },
): void {
  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description:
      "Extract readable content from a URL. Supports extract (single page), crawl (multi-page), and map (URL discovery) modes.",
    parameters: Type.Object({
      url: Type.String({ description: "Primary URL to fetch" }),
      urls: Type.Optional(Type.Array(Type.String(), { description: "Additional URLs (extract mode only)" })),
      query: Type.Optional(Type.String({ description: "Relevance query for Tavily reranking" })),
      mode: Type.Optional(
        Type.Union([Type.Literal("extract"), Type.Literal("crawl"), Type.Literal("map")], {
          default: "extract",
        }),
      ),
      depth: Type.Optional(Type.Union([Type.Literal("basic"), Type.Literal("advanced")])),
      force: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, rawArgs) {
      const args = rawArgs as FetchContentArgs;
      const defaults = defaultProviders(args, deps.cfg);
      const result = await handleFetchContent(args, {
        db: deps.db,
        cfg: deps.cfg,
        providers: {
          ...defaults,
          ...(deps.providers ?? {}),
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
