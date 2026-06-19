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
