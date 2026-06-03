interface PriceRow { inputPerM: number; outputPerM: number; }

const PRICE_TABLE: Record<string, Record<string, PriceRow>> = {
  "google-vertex": {
    "gemini-2.5-flash":              { inputPerM: 0.075, outputPerM: 0.30  },
    "gemini-2.5-flash-lite-preview": { inputPerM: 0.05,  outputPerM: 0.20  },
    "gemini-2.5-pro":                { inputPerM: 1.25,  outputPerM: 5.00  },
    "gemini-3.1-pro-preview":        { inputPerM: 1.50,  outputPerM: 6.00  },
    "gemini-3-flash-preview":        { inputPerM: 0.075, outputPerM: 0.30  },
  },
  "google": {
    "gemini-2.5-flash": { inputPerM: 0.075, outputPerM: 0.30 },
    "gemini-2.5-pro":   { inputPerM: 1.25,  outputPerM: 5.00 },
  },
};

const SUBSCRIPTION_PROVIDERS = new Set(["openai-codex", "opencode", "opencode-go"]);

export function computeCost(args: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number | undefined {
  if (SUBSCRIPTION_PROVIDERS.has(args.provider)) return 0;
  const row = PRICE_TABLE[args.provider]?.[args.model];
  if (!row) return undefined;
  return (args.inputTokens / 1_000_000) * row.inputPerM
       + (args.outputTokens / 1_000_000) * row.outputPerM;
}
