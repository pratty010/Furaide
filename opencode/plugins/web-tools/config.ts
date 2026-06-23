import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { WebToolsConfig, WebProvider, GoogleTransport, WebSearchAdvanced, FetchContentAdvanced } from "./types.ts";

const DEFAULT_WEB_SEARCH_ADVANCED: WebSearchAdvanced = {
  depth: "simple",
  answer: false,
  minScore: 0,
  includeDomains: [],
  excludeDomains: [],
  country: "",
  topic: "general",
  includeImages: false,
  highlights: false,
  braveGoggles: [],
};

const DEFAULT_FETCH_CONTENT_ADVANCED: FetchContentAdvanced = {
  depth: 2,
  maxChars: 100000,
  maxDepth: 2,
  limit: 10,
  selectPaths: [],
  query: "",
  chunksPerSource: 0,
};

export const DEFAULT_WEB_TOOLS_CONFIG: WebToolsConfig = {
  webSearch: {
    defaultProvider: "brave" as WebProvider,
    primaryFallbackOrder: ["brave" as WebProvider, "tavily" as WebProvider, "gemini" as WebProvider],
    reserveFallbackOrder: [],
    count: 5,
    freshness: "pm",
    rawContent: false,
    advanced: { ...DEFAULT_WEB_SEARCH_ADVANCED },
  },
  fetchContent: {
    defaultProvider: "gemini",
    primaryFallbackOrder: ["gemini", "tavily"],
    reserveFallbackOrder: [],
    format: "markdown",
    advanced: { ...DEFAULT_FETCH_CONTENT_ADVANCED },
  },
  mapsSearch: {
    defaultProvider: "gemini",
    count: 5,
  },
  cache: {
    ttl: {
      webSearchMs: 3_600_000,
      fetchContentMs: 86_400_000,
    },
    maxEntries: 256,
  },
  budgets: {
    geminiUsd: 5.0,
    braveRequests: 2000,
    tavilyCredits: 1000,
  },
  google: {
    transport: "auto",
  },
};

const VALID_WEB_PROVIDERS = new Set<WebProvider>(["brave", "tavily", "gemini"]);
const VALID_FETCH_PROVIDERS = new Set(["gemini", "tavily"]);
const VALID_FRESHNESS = new Set(["pd", "pw", "pm", "py"]);
const VALID_FORMATS = new Set(["markdown", "text"]);
const VALID_GOOGLE_TRANSPORTS = new Set<GoogleTransport>(["auto", "vertex", "ai-studio"]);
const VALID_WEB_SEARCH_DEPTHS = new Set(["simple", "deep"]);
const VALID_TOPICS = new Set(["general", "news", "finance", "tech", "science"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return fallback;
  const i = Math.trunc(num);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function clampFloat(n: unknown, fallback: number, min: number, max: number): number {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function clampString<T extends string>(v: unknown, valid: Set<string>, fallback: T): T {
  if (typeof v === "string" && valid.has(v)) return v as T;
  return fallback;
}

function filterUniqueTrimmed(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t.length === 0) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function trimStringMax(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.slice(0, maxLen);
}

function filterProviders(arr: unknown, valid: Set<string>): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of arr) {
    if (typeof p !== "string") continue;
    if (!valid.has(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export function validateConfig(loaded: unknown): WebToolsConfig {
  if (!isPlainObject(loaded)) {
    return structuredClone(DEFAULT_WEB_TOOLS_CONFIG);
  }
  const cfg: Record<string, unknown> = { ...loaded };
  const out: WebToolsConfig = structuredClone(DEFAULT_WEB_TOOLS_CONFIG);

  if (isPlainObject(cfg.webSearch)) {
    const ws = cfg.webSearch as Record<string, unknown>;
    if (typeof ws.defaultProvider === "string" && VALID_WEB_PROVIDERS.has(ws.defaultProvider as WebProvider)) {
      out.webSearch.defaultProvider = ws.defaultProvider as WebProvider;
    }
    out.webSearch.primaryFallbackOrder = filterProviders(ws.primaryFallbackOrder, VALID_WEB_PROVIDERS as Set<string>) as WebProvider[];
    out.webSearch.reserveFallbackOrder = filterProviders(ws.reserveFallbackOrder, VALID_WEB_PROVIDERS as Set<string>) as WebProvider[];
    out.webSearch.count = clampInt(ws.count, out.webSearch.count, 1, 20);
    if (typeof ws.freshness === "string" && VALID_FRESHNESS.has(ws.freshness)) {
      out.webSearch.freshness = ws.freshness as "pd" | "pw" | "pm" | "py";
    }
    if (typeof ws.rawContent === "boolean") {
      out.webSearch.rawContent = ws.rawContent;
    }
    if (isPlainObject(ws.advanced)) {
      const a = ws.advanced as Record<string, unknown>;
      out.webSearch.advanced.depth = clampString(a.depth, VALID_WEB_SEARCH_DEPTHS, "simple");
      if (typeof a.answer === "boolean") out.webSearch.advanced.answer = a.answer;
      out.webSearch.advanced.minScore = clampFloat(a.minScore, 0, 0, 1);
      out.webSearch.advanced.includeDomains = filterUniqueTrimmed(a.includeDomains);
      out.webSearch.advanced.excludeDomains = filterUniqueTrimmed(a.excludeDomains);
      out.webSearch.advanced.country = trimStringMax(a.country, 256);
      out.webSearch.advanced.topic = clampString(a.topic, VALID_TOPICS, "general");
      if (typeof a.includeImages === "boolean") out.webSearch.advanced.includeImages = a.includeImages;
      if (typeof a.highlights === "boolean") out.webSearch.advanced.highlights = a.highlights;
      out.webSearch.advanced.braveGoggles = filterUniqueTrimmed(a.braveGoggles);
    }
  }

  if (isPlainObject(cfg.fetchContent)) {
    const fc = cfg.fetchContent as Record<string, unknown>;
    if (typeof fc.defaultProvider === "string" && VALID_FETCH_PROVIDERS.has(fc.defaultProvider)) {
      out.fetchContent.defaultProvider = fc.defaultProvider as "gemini" | "tavily";
    }
    out.fetchContent.primaryFallbackOrder = filterProviders(fc.primaryFallbackOrder, VALID_FETCH_PROVIDERS) as Array<"gemini" | "tavily">;
    out.fetchContent.reserveFallbackOrder = filterProviders(fc.reserveFallbackOrder, VALID_FETCH_PROVIDERS) as Array<"gemini" | "tavily">;
    if (typeof fc.format === "string" && VALID_FORMATS.has(fc.format)) {
      out.fetchContent.format = fc.format as "markdown" | "text";
    }
    if (isPlainObject(fc.advanced)) {
      const a = fc.advanced as Record<string, unknown>;
      out.fetchContent.advanced.depth = clampInt(a.depth, 2, 1, 10);
      out.fetchContent.advanced.maxChars = clampInt(a.maxChars, 100000, 1, 1_000_000);
      out.fetchContent.advanced.maxDepth = clampInt(a.maxDepth, 2, 1, 10);
      out.fetchContent.advanced.limit = clampInt(a.limit, 10, 1, 100);
      out.fetchContent.advanced.selectPaths = filterUniqueTrimmed(a.selectPaths);
      out.fetchContent.advanced.query = trimStringMax(a.query, 256);
      out.fetchContent.advanced.chunksPerSource = clampInt(a.chunksPerSource, 0, 0, 50);
    }
  }

  if (isPlainObject(cfg.mapsSearch)) {
    const ms = cfg.mapsSearch as Record<string, unknown>;
    if (typeof ms.defaultProvider === "string" && VALID_FETCH_PROVIDERS.has(ms.defaultProvider)) {
      out.mapsSearch.defaultProvider = ms.defaultProvider as "gemini";
    }
    out.mapsSearch.count = clampInt(ms.count, out.mapsSearch.count, 1, 20);
  }

  if (isPlainObject(cfg.cache)) {
    const c = cfg.cache as Record<string, unknown>;
    if (isPlainObject(c.ttl)) {
      const ttl = c.ttl as Record<string, unknown>;
      out.cache.ttl.webSearchMs = clampInt(ttl.webSearchMs, out.cache.ttl.webSearchMs, 0, 7 * 24 * 60 * 60 * 1000);
      out.cache.ttl.fetchContentMs = clampInt(ttl.fetchContentMs, out.cache.ttl.fetchContentMs, 0, 7 * 24 * 60 * 60 * 1000);
    }
    out.cache.maxEntries = clampInt(c.maxEntries, out.cache.maxEntries, 1, 10_000);
  }

  if (isPlainObject(cfg.budgets)) {
    const b = cfg.budgets as Record<string, unknown>;
    out.budgets.geminiUsd = clampFloat(b.geminiUsd, out.budgets.geminiUsd, 0, 1_000_000);
    out.budgets.braveRequests = clampInt(b.braveRequests, out.budgets.braveRequests, 0, 1_000_000_000);
    out.budgets.tavilyCredits = clampInt(b.tavilyCredits, out.budgets.tavilyCredits, 0, 1_000_000_000);
  }

  if (isPlainObject(cfg.google)) {
    const g = cfg.google as Record<string, unknown>;
    if (typeof g.transport === "string" && VALID_GOOGLE_TRANSPORTS.has(g.transport as GoogleTransport)) {
      out.google.transport = g.transport as GoogleTransport;
    } else {
      out.google.transport = "auto";
    }
  }

  return out;
}

export async function loadWebToolsConfig({ configDir }: { configDir: string }): Promise<WebToolsConfig> {
  const rootPath = join(configDir, "web-tools.yml");
  const legacyPath = join(configDir, "config", "web-tools.yml");
  const path = existsSync(rootPath) ? rootPath : legacyPath;
  let loaded: unknown = {};
  if (existsSync(path)) {
    try {
      loaded = parse(await readFile(path, "utf8"));
    } catch {
      loaded = {};
    }
  }
  const merged = mergeDeep(DEFAULT_WEB_TOOLS_CONFIG, isPlainObject(loaded) ? loaded : {});
  return validateConfig(merged);
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
