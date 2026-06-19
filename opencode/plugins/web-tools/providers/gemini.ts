import type { WebProvider } from "../types.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
  score?: number;
  content?: string;
}

export interface SearchProviderMetadata {
  provider: WebProvider;
  latencyMs: number;
  raw?: unknown;
  unitsUsed?: number;
  tokensInput?: number;
  tokensOutput?: number;
}

export interface SearchProviderResult {
  results: SearchResult[];
  metadata: SearchProviderMetadata;
}

export interface FetchContentResult {
  results: Array<{ url: string; title?: string; content?: string }>;
  metadata: SearchProviderMetadata;
}

export interface MapsResult {
  results: Array<{ title: string; uri: string; placeId?: string }>;
  metadata: SearchProviderMetadata;
}

export interface GeminiSearchWebArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  rawContent?: boolean;
}

export interface GeminiFetchContentArgs {
  urls: string[];
  mode?: "extract" | "crawl" | "map";
  format?: "markdown" | "text";
}

export interface GeminiSearchMapsArgs {
  query: string;
  lat?: number;
  lng?: number;
  count?: number;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";
const MAX_CHARS = 100_000;

export async function searchWeb(args: GeminiSearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini web_search requires GEMINI_API_KEY");

  const res = await fetch(
    `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.query }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini web_search ${res.status}: ${body}`);
  }

  const json: any = await res.json();
  const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const usageMeta = json.usageMetadata;
  const answerText = json.candidates?.[0]?.content?.parts?.[0]?.text;

  return {
    results: chunks.slice(0, args.count ?? 5).map((c: any) => ({
      title: c.web?.title ?? "",
      url: c.web?.uri ?? "",
      snippet: (c.web?.title ?? "").slice(0, 500),
    })),
    metadata: {
      provider: "gemini" as WebProvider,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
      tokensInput: usageMeta?.promptTokenCount ?? 0,
      tokensOutput: usageMeta?.candidatesTokenCount ?? 0,
    },
  };
}

export async function fetchContent(args: GeminiFetchContentArgs): Promise<FetchContentResult> {
  const start = performance.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini fetch_content requires GEMINI_API_KEY");

  const results = await Promise.all(
    args.urls.slice(0, 5).map(async (url) => {
      const res = await fetch(
        `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        const body = await res.text().catch(() => "");
        throw new Error(`Gemini url_context ${res.status}: ${body}`);
      }

      const json: any = await res.json();
      const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return { url, title: undefined as string | undefined, content: content.slice(0, MAX_CHARS) };
    }),
  );

  return {
    results,
    metadata: {
      provider: "gemini" as WebProvider,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
    },
  };
}

export async function searchMaps(args: GeminiSearchMapsArgs): Promise<MapsResult> {
  const start = performance.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini maps_search requires GEMINI_API_KEY");

  const res = await fetch(
    `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.query }] }],
        tools: [{ googleMaps: {} }],
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini maps_search ${res.status}: ${body}`);
  }

  const json: any = await res.json();
  const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const usageMeta = json.usageMetadata;

  return {
    results: chunks.slice(0, args.count ?? 5).map((c: any) => {
      const uri = c.web?.uri ?? "";
      const cid = uri.match(/cid=(\d+)/)?.[1];
      return {
        title: c.web?.title ?? "",
        uri,
        placeId: cid ?? undefined,
      };
    }),
    metadata: {
      provider: "gemini" as WebProvider,
      latencyMs: Math.round(performance.now() - start),
      unitsUsed: 1,
      tokensInput: usageMeta?.promptTokenCount ?? 0,
      tokensOutput: usageMeta?.candidatesTokenCount ?? 0,
    },
  };
}
