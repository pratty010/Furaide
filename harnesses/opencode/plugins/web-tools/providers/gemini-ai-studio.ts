import type { PricingHelper } from "../pricing.ts";
import { isSafePublicUrl, truncateErrorBody } from "../util/validate.ts";
import type { SearchResult, SearchProviderResult, FetchContentResult, MapsResult, GeminiSearchWebArgs, GeminiFetchContentArgs, GeminiSearchMapsArgs } from "./gemini.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const MAX_CHARS = 100_000;
const GEMINI_TIMEOUT_MS = 30_000;
const GEMINI_MAX_URLS = 5;
const GEMINI_COUNT_CLAMP = 20;

function estimateGeminiCost(pricing: PricingHelper | undefined, model: string, tool: "google_search" | "googleMaps" | "url_context", tokensInput: number, tokensOutput: number): number | undefined {
  if (!pricing) return undefined;
  try {
    return pricing.estimateGeminiCall({ model, inputTokens: tokensInput, outputTokens: tokensOutput, tool });
  } catch {
    return undefined;
  }
}

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > GEMINI_COUNT_CLAMP) return GEMINI_COUNT_CLAMP;
  return n;
}

interface GeminiErrorPayload {
  status: number;
  bodyPreview: string;
}

async function safeReadErrorPayload(res: Response): Promise<GeminiErrorPayload> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  return { status: res.status, bodyPreview: truncateErrorBody(body) };
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function buildHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("x-goog-api-key", process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "");
  return headers;
}

export async function searchWebAiStudio(args: GeminiSearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const count = clampCount(args.count, 5);

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: args.query }] }],
    tools: [{ google_search: {} }],
  };

  const res = await fetch(
    `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: buildHeaders(),
      signal: timeoutSignal(GEMINI_TIMEOUT_MS),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const { status, bodyPreview } = await safeReadErrorPayload(res);
    throw new Error(`Gemini web_search ${status}: ${bodyPreview}`);
  }

  const json: any = await res.json();
  const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const usageMeta = json.usageMetadata;

  const tokensInput = usageMeta?.promptTokenCount ?? 0;
  const tokensOutput = usageMeta?.candidatesTokenCount ?? 0;
  const estimatedCostUsd = estimateGeminiCost(args.pricing, DEFAULT_MODEL, "google_search", tokensInput, tokensOutput);

  return {
    results: chunks.slice(0, count).map((c: any) => ({
      title: c.web?.title ?? "",
      url: c.web?.uri ?? "",
      snippet: "",
    })),
    metadata: {
      provider: "gemini" as const,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
      tokensInput,
      tokensOutput,
      estimatedCostUsd,
    },
  };
}

export async function fetchContentAiStudio(args: GeminiFetchContentArgs): Promise<FetchContentResult> {
  const start = performance.now();

  if (!Array.isArray(args.urls) || args.urls.length === 0) {
    throw new Error("Gemini fetch_content requires at least one URL");
  }
  if (args.urls.length > GEMINI_MAX_URLS) {
    throw new Error(`Gemini fetch_content accepts at most ${GEMINI_MAX_URLS} URLs (got ${args.urls.length})`);
  }
  const validatedUrls: string[] = [];
  for (let i = 0; i < args.urls.length; i++) {
    const safe = isSafePublicUrl(String(args.urls[i] ?? ""));
    if (!safe.ok) throw new Error(`Gemini URL[${i}] rejected: ${safe.reason}`);
    validatedUrls.push(safe.url.toString());
  }

  let totalTokensInput = 0;
  let totalTokensOutput = 0;

  const results = await Promise.all(
    validatedUrls.map(async (url) => {
      const res = await fetch(
        `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent`,
        {
          method: "POST",
          headers: buildHeaders(),
          signal: timeoutSignal(GEMINI_TIMEOUT_MS),
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [{ text: `Extract the readable content of ${url} as clean markdown` }],
            }],
            tools: [{ url_context: {} }],
          }),
        },
      );

      if (!res.ok) {
        const { status, bodyPreview } = await safeReadErrorPayload(res);
        throw new Error(`Gemini url_context ${status}: ${bodyPreview}`);
      }

      const json: any = await res.json();
      const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const usageMeta = json.usageMetadata;
      totalTokensInput += usageMeta?.promptTokenCount ?? 0;
      totalTokensOutput += usageMeta?.candidatesTokenCount ?? 0;
      return { url, title: undefined as string | undefined, content: content.slice(0, MAX_CHARS) };
    }),
  );

  const estimatedCostUsd = estimateGeminiCost(args.pricing, DEFAULT_MODEL, "url_context", totalTokensInput, totalTokensOutput);

  return {
    results,
    metadata: {
      provider: "gemini" as const,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
      tokensInput: totalTokensInput,
      tokensOutput: totalTokensOutput,
      estimatedCostUsd,
    },
  };
}

export async function searchMapsAiStudio(args: GeminiSearchMapsArgs): Promise<MapsResult> {
  const start = performance.now();
  const count = clampCount(args.count, 5);

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: args.query }] }],
    tools: [{ googleMaps: {} }],
  };

  if (args.lat !== undefined && args.lng !== undefined) {
    body.toolConfig = {
      retrievalConfig: {
        latLng: { latitude: args.lat, longitude: args.lng },
      },
    };
  }

  const res = await fetch(
    `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: buildHeaders(),
      signal: timeoutSignal(GEMINI_TIMEOUT_MS),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const { status, bodyPreview } = await safeReadErrorPayload(res);
    throw new Error(`Gemini maps_search ${status}: ${bodyPreview}`);
  }

  const json: any = await res.json();
  const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const usageMeta = json.usageMetadata;

  const tokensInput = usageMeta?.promptTokenCount ?? 0;
  const tokensOutput = usageMeta?.candidatesTokenCount ?? 0;
  const estimatedCostUsd = estimateGeminiCost(args.pricing, DEFAULT_MODEL, "googleMaps", tokensInput, tokensOutput);

  return {
    results: chunks.slice(0, count).map((c: any) => {
      const maps = c.maps ?? {};
      return {
        title: maps.title ?? "",
        uri: maps.uri ?? "",
        placeId: maps.placeId ?? undefined,
      };
    }),
    metadata: {
      provider: "gemini" as const,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
      tokensInput,
      tokensOutput,
      estimatedCostUsd,
    },
  };
}
