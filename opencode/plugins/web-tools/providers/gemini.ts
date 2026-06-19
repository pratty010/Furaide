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

export async function searchWeb(args: GeminiSearchWebArgs): Promise<SearchProviderResult> {
  const start = performance.now();
  throw new Error("Gemini web_search not yet implemented");
}

export async function fetchContent(args: GeminiFetchContentArgs): Promise<FetchContentResult> {
  const start = performance.now();
  throw new Error("Gemini fetch_content not yet implemented");
}

export async function searchMaps(args: GeminiSearchMapsArgs): Promise<MapsResult> {
  const start = performance.now();
  throw new Error("Gemini maps_search not yet implemented");
}
