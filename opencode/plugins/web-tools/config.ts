import { readFile, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { WebToolsConfig, WebProvider } from "./types.ts";

export const DEFAULT_WEB_TOOLS_CONFIG: WebToolsConfig = {
  webSearch: {
    defaultProvider: "brave" as WebProvider,
    primaryFallbackOrder: ["brave" as WebProvider, "tavily" as WebProvider, "gemini" as WebProvider],
    reserveFallbackOrder: [],
    count: 5,
    freshness: "pm",
    rawContent: false,
  },
  fetchContent: {
    defaultProvider: "gemini",
    primaryFallbackOrder: ["gemini", "tavily"],
    reserveFallbackOrder: [],
    format: "markdown",
  },
  mapsSearch: {
    defaultProvider: "gemini",
    count: 5,
  },
  cache: {
    syncIntervalMs: 300_000,
    ttl: {
      webSearchMs: 3_600_000,
      fetchContentMs: 86_400_000,
    },
  },
  budgets: {
    geminiUsd: 5.0,
    braveRequests: 2000,
    tavilyCredits: 1000,
  },
};

export async function loadWebToolsConfig({ configDir }: { configDir: string }): Promise<WebToolsConfig> {
  const path = join(configDir, "web-tools.yml");
  const loaded = existsSync(path) ? parse(await readFile(path, "utf8")) : {};
  return mergeDeep(DEFAULT_WEB_TOOLS_CONFIG, loaded) as WebToolsConfig;
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = mergeDeep(
        (result[key] as Record<string, unknown>) ?? {},
        source[key] as Record<string, unknown>,
      );
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}
