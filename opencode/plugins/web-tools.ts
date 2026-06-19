import { type Plugin, tool } from "@opencode-ai/plugin";
import { loadWebToolsConfig } from "./web-tools/config.ts";
import type { WebToolsConfig, WebProvider } from "./web-tools/types.ts";
import { InMemoryCache } from "./web-tools/cache.ts";
import { createTables, recordWebSearch, recordFetchContent } from "./web-tools/db.ts";
import { createUsageTracker } from "./web-tools/provider-usage.ts";
import type { BudgetConfig } from "./web-tools/types.ts";
import { executeWebSearchTool, type WebSearchArgs, type NormalizedWebSearchRequest, type WebSearchRuntime, type SearchProviderResult as WebSearchProviderResult } from "./web-tools/tools/web-search.ts";
import { executeFetchContentTool, type FetchContentArgs, type NormalizedFetchContentRequest, type FetchContentRuntime, type FetchProviderResult } from "./web-tools/tools/fetch-content.ts";
import { executeMapsSearchTool, type MapsSearchArgs, type MapsSearchRuntime } from "./web-tools/tools/maps-search.ts";
import * as gemini from "./web-tools/providers/gemini.ts";
import * as brave from "./web-tools/providers/brave.ts";
import * as tavily from "./web-tools/providers/tavily.ts";
import { effectiveOrder } from "./web-tools/order.ts";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadPricingHelper } from "./web-tools/pricing.ts";

async function createWebToolsRuntime(ctx: { directory: string }): Promise<WebSearchRuntime & FetchContentRuntime & MapsSearchRuntime> {
  const config = await loadWebToolsConfig({ configDir: ctx.directory });
  const cache = new InMemoryCache({
    webSearchTtlMs: config.cache.ttl.webSearchMs,
    fetchContentTtlMs: config.cache.ttl.fetchContentMs,
  });

  const dataDir = join(homedir(), ".local", "share", "opencode", "web-tools");
  let db: Database;
  try {
    db = new Database(join(dataDir, "data.db"), { create: true });
  } catch {
    db = new Database(":memory:");
  }
  createTables(db);

  const budgets: BudgetConfig = {
    geminiUsd: config.budgets.geminiUsd,
    braveRequests: config.budgets.braveRequests,
    tavilyCredits: config.budgets.tavilyCredits,
  };
  const usage = createUsageTracker(db, budgets);
  const pricing = loadPricingHelper({ configDir: ctx.directory, docsDir: ctx.directory });

  const runtimeDb = {
    async recordWebSearch(request: NormalizedWebSearchRequest, result: WebSearchProviderResult) {
      recordWebSearch(db, request, result);
    },
    async recordFetchContent(request: NormalizedFetchContentRequest, result: FetchProviderResult) {
      recordFetchContent(db, request, result);
    },
  };

  async function checkProviderBudget(provider: "gemini" | "brave" | "tavily"): Promise<string | null> {
    const month = new Date().toISOString().slice(0, 7);
    const snapshot = await usage.getMonth(provider, month);
    const { checkBudget } = await import("./web-tools/provider-usage.ts");
    const result = checkBudget(budgets, snapshot, provider);
    return result.blocked ? result.preamble : null;
  }

  const providers = {
    async searchWithFallback(request: NormalizedWebSearchRequest) {
      const order = effectiveOrder(
        config.webSearch.defaultProvider,
        config.webSearch.primaryFallbackOrder,
        config.webSearch.reserveFallbackOrder,
      );
      const errors: string[] = [];
      for (const p of order) {
        const blockReason = await checkProviderBudget(p);
        if (blockReason) {
          errors.push(`${p}: budget exceeded`);
          continue;
        }
        try {
          if (p === "brave") return await brave.searchWeb(request);
          if (p === "tavily") return await tavily.searchWeb(request);
          if (p === "gemini") return await gemini.searchWeb({ ...request, pricing });
        } catch (e: any) {
          errors.push(`${p}: ${e.message}`);
        }
      }
      throw new Error(`searchWithFallback: all providers failed — ${errors.join("; ")}`);
    },
    async fetchWithFallback(request: NormalizedFetchContentRequest) {
      const order = effectiveOrder(
        config.fetchContent.defaultProvider,
        config.fetchContent.primaryFallbackOrder,
        config.fetchContent.reserveFallbackOrder,
      );
      const errors: string[] = [];
      for (const p of order) {
        const blockReason = await checkProviderBudget(p);
        if (blockReason) {
          errors.push(`${p}: budget exceeded`);
          continue;
        }
        try {
          if (p === "gemini") return await gemini.fetchContent({ ...request, pricing });
          if (p === "tavily") return await tavily.fetchContent(request);
        } catch (e: any) {
          errors.push(`${p}: ${e.message}`);
        }
      }
      throw new Error(`fetchWithFallback: all providers failed — ${errors.join("; ")}`);
    },
    async searchMaps(request: Parameters<typeof gemini.searchMaps>[0]) {
      return await gemini.searchMaps({ ...request, pricing });
    },
  };

  async function recordWithBudget(provider: string, metadata: { unitsUsed?: number; tokensInput?: number; tokensOutput?: number; estimatedCostUsd?: number }): Promise<string | null> {
    const { snapshot, budget } = await usage.checkAndRecord({
      provider: provider as WebProvider,
      unitsUsed: metadata.unitsUsed,
      tokensInput: metadata.tokensInput,
      tokensOutput: metadata.tokensOutput,
      estimatedCostUsd: metadata.estimatedCostUsd,
    });
    return budget.preamble;
  }

  return { config, cache, db: runtimeDb, usage, providers, recordWithBudget };
}

export const WebToolsPlugin: Plugin = async (ctx) => {
  const runtime = await createWebToolsRuntime(ctx);

  return {
    tool: {
      web_search: tool({
        description: "Search the web and return relevant results",
        args: {
          query: tool.schema.string().describe("Search query"),
          count: tool.schema.number().optional().describe("Number of results to return"),
          freshness: tool.schema.enum(["pd", "pw", "pm", "py"]).optional().describe("Freshness filter: past day/week/month/year"),
          raw_content: tool.schema.boolean().optional().describe("Return full content instead of snippets"),
        },
        async execute(args: WebSearchArgs) {
          const result = await executeWebSearchTool(args, runtime);
          return result;
        },
      }),
      fetch_content: tool({
        description: "Fetch content from URLs with extract, crawl, or map mode",
        args: {
          urls: tool.schema.array(tool.schema.string()).describe("URLs to fetch content from"),
          mode: tool.schema.enum(["extract", "crawl", "map"]).optional().describe("Fetch mode"),
          format: tool.schema.enum(["markdown", "text"]).optional().describe("Output format"),
        },
        async execute(args: FetchContentArgs) {
          const result = await executeFetchContentTool(args, runtime);
          return result;
        },
      }),
      maps_search: tool({
        description: "Search for places and locations using Gemini Maps grounding",
        args: {
          query: tool.schema.string().describe("Location or place search query"),
          lat: tool.schema.number().optional().describe("Latitude for location-biased search"),
          lng: tool.schema.number().optional().describe("Longitude for location-biased search"),
          count: tool.schema.number().optional().describe("Number of results to return"),
        },
        async execute(args: MapsSearchArgs) {
          const result = await executeMapsSearchTool(args, runtime);
          return result;
        },
      }),
    },
  };
};
