import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { WebConfig } from "./schema.ts";
import { DEFAULT_WEB_CONFIG } from "./schema.ts";

const DEFAULT_CONFIG_DIR = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "friday",
  "config",
);

const TOOLS_YAML_TEMPLATE = `# Friday web subsystem tools configuration.
# User-specific tool and provider settings live here.
# Edit values below to customize behavior.

providers:
  gemini:
    # Master enable switch for Gemini-backed features.
    enabled: true

    # Environment variable used for Gemini authentication.
    apiKeyEnv: GEMINI_API_KEY

    # Model used by web_search with Google Search grounding.
    searchModel: gemini-2.5-flash

    # Model used by fetch_content when URL Context is needed.
    urlContextModel: gemini-2.5-flash

    # Model used by video_search when yt-dlp cannot produce subtitles.
    videoModel: gemini-3-flash-preview

  brave:
    # Enable Brave as a primary web_search provider and the main video_search provider.
    enabled: true

    # Environment variable used for Brave authentication.
    apiKeyEnv: BRAVE_SEARCH_API_KEY

    # Per-request timeout passed to Brave search CLI wrappers.
    timeoutSec: 30

    # Default Brave result filter for web search.
    # Allowed values are a comma-separated list of Brave vertical filters.
    resultFilter: discussions,news,query,videos,web

  tavily:
    # Enable Tavily as a primary fallback provider.
    enabled: true

    # Environment variable used for Tavily authentication.
    apiKeyEnv: TAVILY_API_KEY

    # Default Tavily search depth.
    # Allowed values: basic, advanced.
    depth: basic

  exa:
    # Enable Exa as a reserve provider for web_search and the final fallback for fetch_content.
    enabled: true

    # Environment variable used for Exa authentication.
    apiKeyEnv: EXA_API_KEY

  serper:
    # Enable Serper as a reserve provider only.
    enabled: false

    # Environment variable used for Serper authentication.
    apiKeyEnv: SERPER_API_KEY

  ctx7:
    # Enable Context7 for code_search.
    enabled: true

    # Optional Context7 API key environment variable.
    apiKeyEnv: CONTEXT7_API_KEY

  github:
    # Enable GitHub CLI backed code search when gh is installed and authenticated.
    enabled: true

  ytDlp:
    # Enable yt-dlp subtitle extraction for video_search enrichment.
    enabled: true

    # Dedicated timeout for yt-dlp subtitle extraction.
    timeoutSec: 30

    # Optional browser cookie source for sites that need authenticated playback metadata.
    # Example values: chrome, firefox, edge.
    cookiesFromBrowser: null

webSearch:
  # Default provider used for the first attempt.
  # Allowed values: gemini, brave, tavily, exa, serper.
  defaultProvider: gemini

  # Ordered list of primary providers used when the default provider fails.
  primaryFallbackOrder:
    - gemini
    - brave
    - tavily

  # Ordered list of reserve providers.
  reserveFallbackOrder:
    - exa
    - serper

  # If true, reserve providers are used after the primary tier fails.
  useReserveProviders: true

  # Default maximum result count.
  count: 20

  # Default freshness filter.
  # Allowed values: null, pd, pw, pm, py.
  freshness: null

  # Restrict results to these domains when non-empty.
  includeDomains: []

  # Exclude results from these domains when non-empty.
  excludeDomains: []

fetchContent:
  # Maximum output characters returned to the tool caller.
  maxChars: 50000

  tavily:
    # Default extract output format.
    # Allowed values: markdown, text.
    format: markdown

    # Default Tavily extract depth.
    # Allowed values: basic, advanced.
    depth: basic

codeSearch:
  # Default maximum merged result count for code/doc matches.
  limit: 30

videoSearch:
  # Default maximum video result count.
  count: 20

  # Default freshness filter.
  # Allowed values: null, pd, pw, pm, py.
  freshness: null

  # If true, try to enrich video results with transcript or Gemini fallback.
  transcript: false

  # Subtitle language preference passed to yt-dlp.
  transcriptLangs:
    - en

  # Subtitle format requested from yt-dlp.
  # Allowed values: vtt, srt, best.
  subtitleFormat: vtt

  # If true, prefer auto-generated subtitles when manual subtitles are unavailable.
  preferAutoSubs: true

  # Maximum number of characters retained from extracted transcript text.
  maxTranscriptChars: 5000

  # Gemini fallback mode used when transcript extraction fails.
  # Allowed values: timestamped_summary.
  geminiFallback: timestamped_summary

semanticCache:
  # Master enable switch for the semantic cache.
  enabled: true

  # Which embedding provider to use.
  # Allowed values: google, ollama, openai-compat, local.
  provider: google

  # Similarity threshold at which cached results are returned as fully authoritative.
  hardThreshold: 0.88

  # Similarity threshold at which cached results are returned with a soft-hit marker
  # so the calling LLM can decide whether to request a refresh.
  softThreshold: 0.75

  # Per-tool cache lifetime in milliseconds. Tools not listed here bypass the cache.
  ttl:
    web_search: 3600000
    video_search: 21600000
    fetch_content: 86400000

  google:
    # Google Gemini embedding model.
    model: gemini-embedding-2-preview
    # Environment variable used for Gemini authentication.
    apiKeyEnv: GEMINI_API_KEY

  ollama:
    # Base URL of the Ollama host.
    baseUrl: http://localhost:11434
    # Ollama embedding model.
    model: nomic-embed-text-v2-moe

  openaiCompat:
    # Base URL of any OpenAI-compatible embedding endpoint
    # (DeepSeek, Qwen, vLLM, LM Studio, etc.).
    baseUrl: http://localhost:11434/v1
    # Embedding model name understood by the endpoint.
    model: text-embedding-3-small
    # Environment variable used for bearer token auth, if any.
    apiKeyEnv: OPENAI_API_KEY

  local:
    # Pure-JS/WASM embedding model (zero API keys, runs in-process).
    model: Xenova/all-MiniLM-L6-v2

runner:
  # Default timeout for general subprocesses.
  timeoutMs: 15000
`;

const SYSTEM_YAML_TEMPLATE = `# Friday web subsystem system configuration.
# User-specific system, model, path, and quota settings live here.
# Edit values below to customize behavior.

models:
  providers:
    opencode:            { emoji: "🟢", thinkingTiers: [pro, team] }
    opencode-go:         { emoji: "🟢", thinkingTiers: [pro] }
    github-copilot:      { emoji: "🐙", thinkingTiers: [all] }
    kimi-coding:         { emoji: "🌙", thinkingTiers: [all] }
    zai:                 { emoji: "⚡", thinkingTiers: [] }
    vercel-ai-gateway:   { emoji: "▲", thinkingTiers: [all] }
  # Optional: set your tier per provider to gate the footer's thinking display.
  # Allowed values: free, pro, team, paid.
  # userTiers:
  #   opencode: pro

paths:
  # Friday-scoped runtime state root.
  stateRoot: ~/.pi/agent/extensions/friday/state/web

  # Single SQLite file holding pages, queries, and usage tables.
  dbFile: ~/.pi/agent/extensions/friday/state/web/web.db

# Default timezone for session metrics and time display.
timezone: Asia/Kolkata

quotas:
  toolProviders:
    brave:
      # Data source: provider-backed monthly quota.
      source: provider
      unit: credits
      monthLimit: 2000
      resetDay: 1

    tavily:
      # Data source: provider-backed monthly quota.
      source: provider
      unit: credits
      monthLimit: 1000
      resetDay: 1

    exa:
      # Data source: local budget estimate.
      source: local
      unit: usd
      totalBudget: 20

    serper:
      # Data source: local credit target.
      source: local
      unit: credits
      totalBudget: 2500

  modelProviders:
    openai-codex:  { source: local, unit: messages, rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 }
    opencode:      { source: local, unit: requests, rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 }
    opencode-go:   { source: local, unit: requests, rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 }
    google-vertex: { source: local, unit: usd,      rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 }
    google:        { source: local, unit: requests, rolling5hLimit: null, rolling1wLimit: null, rolling1moLimit: null, used5h: 0, used1w: 0, used1mo: 0 }

  apiProviders:
    google:  { apiCostTotal: 0, apiCostLimit: null }
    openai:  { apiCostTotal: 0, apiCostLimit: null }

  apiGroups:
    google-all: { providers: [google, google-vertex], combinedBudget: 300, note: "Vertex + Gemini combined" }
`;

export interface LoadOptions {
  configDir?: string;
}

export interface UsagePatch {
  toolProviders?: Record<string, Record<string, unknown>>;
  modelProviders?: Record<string, { used5h?: number; used1w?: number; used1mo?: number }>;
  apiProviders?: Record<string, { apiCostTotal?: number }>;
}

export function resolveTilde(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function deepClone<T>(obj: T): T {
  if (obj == null) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;
  const out: any = {};
  for (const k of Object.keys(obj)) {
    out[k] = deepClone((obj as any)[k]);
  }
  return out;
}

function deepMerge<T>(base: T, patch: any): T {
  if (patch == null) return deepClone(base);
  if (Array.isArray(base) || Array.isArray(patch)) return (patch ?? base) as T;
  if (typeof base !== "object" || typeof patch !== "object") return (patch ?? base) as T;
  const out: any = { ...(base as any) };
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge((base as any)[k], patch[k]);
  }
  return out;
}

function readYaml(path: string): { data: any; error?: Error } {
  if (!existsSync(path)) return { data: {} };
  try { return { data: parseYaml(readFileSync(path, "utf8")) ?? {} }; }
  catch (e: any) { return { data: {}, error: e }; }
}

function readSecrets(cfg: WebConfig): Record<string, string | undefined> {
  const envs = new Set<string>();
  const provs = cfg.providers as any;
  for (const p of Object.values(provs)) {
    const env = (p as any)?.apiKeyEnv;
    if (typeof env === "string" && env) envs.add(env);
  }
  if (cfg.semanticCache.google.apiKeyEnv)       envs.add(cfg.semanticCache.google.apiKeyEnv);
  if (cfg.semanticCache.openaiCompat.apiKeyEnv) envs.add(cfg.semanticCache.openaiCompat.apiKeyEnv);
  const out: Record<string, string | undefined> = {};
  for (const k of envs) out[k] = process.env[k];
  return out;
}

export function loadWebConfig(opts?: LoadOptions): WebConfig {
  const configDir = opts?.configDir ?? DEFAULT_CONFIG_DIR;
  const toolsPath = join(configDir, "tools.yml");
  const systemPath = join(configDir, "system.yml");

  if (!existsSync(toolsPath) || !existsSync(systemPath)) {
    mkdirSync(configDir, { recursive: true });
    if (!existsSync(toolsPath)) {
      writeFileSync(toolsPath, TOOLS_YAML_TEMPLATE, "utf8");
    }
    if (!existsSync(systemPath)) {
      writeFileSync(systemPath, SYSTEM_YAML_TEMPLATE, "utf8");
    }
  }

  const toolsRes = readYaml(toolsPath);
  const systemRes = readYaml(systemPath);

  let merged = deepMerge(deepClone(DEFAULT_WEB_CONFIG), toolsRes.data);
  merged = deepMerge(merged, systemRes.data) as WebConfig;

  // Resolve tilde paths
  const home = process.env.HOME ?? "";
  if (home) {
    if (merged.paths.stateRoot.startsWith("~/")) {
      merged.paths.stateRoot = join(home, merged.paths.stateRoot.slice(2));
    }
    if (merged.paths.dbFile.startsWith("~/")) {
      merged.paths.dbFile = join(home, merged.paths.dbFile.slice(2));
    }
  }

  merged.secrets = readSecrets(merged);

  return merged;
}

export function persistUsage(opts: { configDir?: string; usage: UsagePatch }): void {
  const configDir = opts.configDir ?? DEFAULT_CONFIG_DIR;
  const systemPath = join(configDir, "system.yml");

  const existingRes = readYaml(systemPath);
  if (existingRes.error) {
    // Abort write-back if file exists but fails to parse to avoid clobbering
    return;
  }

  const existing = existingRes.data;
  const patch = { quotas: opts.usage };
  const merged = deepMerge(existing, patch);

  writeFileSync(systemPath, stringifyYaml(merged), "utf8");
}
