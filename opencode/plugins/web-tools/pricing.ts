import { readFile, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface LiteLLMPriceEntry {
  input_cost_per_token: number;
  output_cost_per_token: number;
}

export interface PricingInput {
  litellm: Record<string, LiteLLMPriceEntry>;
  fees: Record<string, Record<string, number>>;
}

export interface EstimateGeminiCallInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  tool: "google_search" | "googleMaps" | "url_context";
}

export interface PricingHelper {
  estimateGeminiCall(input: EstimateGeminiCallInput): number;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function lookupPrice(prices: Record<string, LiteLLMPriceEntry>, model: string): LiteLLMPriceEntry | undefined {
  return prices[model] ?? prices[`google/${model}`] ?? prices[`gemini/${model}`] ?? undefined;
}

export function createPricingHelper(input: PricingInput): PricingHelper {
  const { litellm, fees } = input;

  return {
    estimateGeminiCall({ model, inputTokens, outputTokens, tool }: EstimateGeminiCallInput): number {
      const modelPrice = lookupPrice(litellm, model);
      if (!modelPrice) {
        throw new Error(`Unknown model: ${model}`);
      }

      const tokenCost = inputTokens * modelPrice.input_cost_per_token + outputTokens * modelPrice.output_cost_per_token;
      const toolFee = fees[model]?.[tool] ?? 0;

      return roundUsd(tokenCost + toolFee);
    },
  };
}

export interface LoadPricingOptions {
  configDir: string;
  docsDir: string;
}

const DEFAULT_LITELLM_PRICES: Record<string, LiteLLMPriceEntry> = {
  "gemini-3.1-flash-lite": { input_cost_per_token: 0.000000075, output_cost_per_token: 0.0000003 },
  "google/gemini-3.1-flash-lite": { input_cost_per_token: 0.000000075, output_cost_per_token: 0.0000003 },
};

const DEFAULT_TOOL_FEES: Record<string, Record<string, number>> = {
  "gemini-3.1-flash-lite": { google_search: 0.035, googleMaps: 0.035, url_context: 0 },
};

function loadToolFeesSync(docsDir: string): Record<string, Record<string, number>> {
  const path = join(docsDir, "models", "gemini-tool-fees.yml");
  if (!existsSync(path)) return DEFAULT_TOOL_FEES;
  try {
    const raw = parse(readFile(path, "utf8"));
    return raw as Record<string, Record<string, number>>;
  } catch {
    return DEFAULT_TOOL_FEES;
  }
}

function loadLitellmCacheSync(configDir: string): Record<string, LiteLLMPriceEntry> | null {
  const path = join(homedir(), ".local", "share", "opencode", "web-tools", "pricing-cache.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFile(path, "utf8"));
    if (raw && typeof raw.fetchedAt === "number" && Date.now() - raw.fetchedAt < 86_400_000 && raw.prices) {
      return raw.prices as Record<string, LiteLLMPriceEntry>;
    }
  } catch {}
  return null;
}

import { homedir } from "node:os";

export function loadPricingHelper(opts: LoadPricingOptions): PricingHelper {
  const litellm = loadLitellmCacheSync(opts.configDir) ?? DEFAULT_LITELLM_PRICES;
  const fees = loadToolFeesSync(opts.docsDir);
  return createPricingHelper({ litellm, fees });
}
