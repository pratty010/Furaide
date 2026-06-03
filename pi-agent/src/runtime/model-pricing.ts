import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_TTL_MS = 24 * 3600_000;

export interface ModelPricing {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheWriteCostPerToken: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface EstimateResult {
  cost: number;
  isEstimate: true;
}

interface PriceCache {
  fetchedAt: number;
  prices: Record<string, ModelPricing>;
}

let _cache: PriceCache | null = null;

function loadCacheFile(statePath: string): PriceCache | null {
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    if (typeof raw.fetchedAt !== "number" || typeof raw.prices !== "object") return null;
    return raw as PriceCache;
  } catch {
    return null;
  }
}

function parseLiteLLM(raw: Record<string, unknown>): Record<string, ModelPricing> {
  const prices: Record<string, ModelPricing> = {};
  for (const [model, data] of Object.entries(raw)) {
    if (!data || typeof data !== "object") continue;
    const d = data as Record<string, unknown>;
    if (typeof d.input_cost_per_token !== "number") continue;
    prices[model] = {
      inputCostPerToken: d.input_cost_per_token as number,
      outputCostPerToken: (d.output_cost_per_token as number) ?? 0,
      cacheReadCostPerToken: (d.cache_read_input_token_cost as number) ?? 0,
      cacheWriteCostPerToken: (d.cache_creation_input_token_cost as number) ?? 0,
      maxInputTokens: (d.max_input_tokens ?? d.max_tokens ?? 0) as number,
      maxOutputTokens: (d.max_output_tokens ?? d.max_tokens ?? 0) as number,
    };
  }
  return prices;
}

export async function loadPricing(statePath: string): Promise<void> {
  const existing = loadCacheFile(statePath);
  if (existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS) {
    _cache = existing;
    return;
  }
  try {
    const resp = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = (await resp.json()) as Record<string, unknown>;
    const newCache: PriceCache = { fetchedAt: Date.now(), prices: parseLiteLLM(raw) };
    _cache = newCache;
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(newCache, null, 2), "utf8");
  } catch {
    _cache = existing ?? { fetchedAt: 0, prices: {} };
  }
}

export function getPricing(model: string): ModelPricing | null {
  if (!_cache) return null;
  return (
    _cache.prices[model] ??
    _cache.prices[model.split(":")[0]!] ??
    null
  );
}

export function estimateCost(
  model: string,
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
): EstimateResult | null {
  const p = getPricing(model);
  if (!p) return null;
  const cost =
    tokens.inputTokens * p.inputCostPerToken +
    tokens.outputTokens * p.outputCostPerToken +
    (tokens.cacheReadTokens ?? 0) * p.cacheReadCostPerToken +
    (tokens.cacheWriteTokens ?? 0) * p.cacheWriteCostPerToken;
  return { cost, isEstimate: true };
}

export function getContextWindow(model: string): number | null {
  const p = getPricing(model);
  return p ? p.maxInputTokens : null;
}

export function _injectPricesForTest(prices: Record<string, ModelPricing>): void {
  _cache = { fetchedAt: Date.now(), prices };
}
