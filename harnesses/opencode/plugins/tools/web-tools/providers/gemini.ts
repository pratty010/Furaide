import type { WebProvider, GoogleTransport, ResultMetadata } from "../types.ts";
import type { PricingHelper } from "../pricing.ts";
import { selectGoogleTransport } from "./transport-select.ts";
import { searchWebAiStudio, fetchContentAiStudio, searchMapsAiStudio } from "./gemini-ai-studio.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
  score?: number;
  content?: string;
}

export interface SearchProviderResult {
  results: SearchResult[];
  metadata: ResultMetadata;
}

export interface FetchContentResult {
  results: Array<{ url: string; title?: string; content?: string }>;
  metadata: ResultMetadata;
}

export interface MapsResult {
  results: Array<{ title: string; uri: string; placeId?: string }>;
  metadata: ResultMetadata;
}

export interface GeminiSearchWebArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  rawContent?: boolean;
  pricing?: PricingHelper;
  transport?: GoogleTransport;
}

export interface GeminiFetchContentArgs {
  urls: string[];
  mode?: "extract" | "crawl" | "map";
  format?: "markdown" | "text";
  pricing?: PricingHelper;
  transport?: GoogleTransport;
}

export interface GeminiSearchMapsArgs {
  query: string;
  lat?: number;
  lng?: number;
  count?: number;
  pricing?: PricingHelper;
  transport?: GoogleTransport;
}

function providerError(tool: string, reason: string): Error {
  return new Error(`Gemini ${tool}: ${reason}`);
}

let vertexInit: Promise<any> | null = null;

async function getVertex() {
  if (!vertexInit) {
    vertexInit = import("./gemini-vertex.ts").catch((e: any) => {
      throw new Error(`Gemini: Vertex transport unavailable - ${e.message}`);
    });
  }
  return vertexInit;
}

export async function searchWeb(args: GeminiSearchWebArgs): Promise<SearchProviderResult> {
  const transport = args.transport ?? "auto";
  const selection = selectGoogleTransport(transport);
  if (selection.kind === "none") throw providerError("web_search", selection.reason);
  if (selection.kind === "ai-studio") return searchWebAiStudio(args);
  const v = await getVertex();
  return v.searchWebVertex(args);
}

export async function fetchContent(args: GeminiFetchContentArgs): Promise<FetchContentResult> {
  const mode = args.mode ?? "extract";
  if (mode !== "extract") {
    throw new Error(`Gemini fetch_content does not support mode '${mode}'. Only 'extract' is supported. Use Tavily for '${mode}' mode.`);
  }

  const transport = args.transport ?? "auto";
  const selection = selectGoogleTransport(transport);
  if (selection.kind === "none") throw providerError("fetch_content", selection.reason);
  if (selection.kind === "ai-studio") return fetchContentAiStudio(args);
  const v = await getVertex();
  return v.fetchContentVertex(args);
}

export async function searchMaps(args: GeminiSearchMapsArgs): Promise<MapsResult> {
  const transport = args.transport ?? "auto";
  const selection = selectGoogleTransport(transport);
  if (selection.kind === "none") throw providerError("maps_search", selection.reason);
  if (selection.kind === "ai-studio") return searchMapsAiStudio(args);
  const v = await getVertex();
  return v.searchMapsVertex(args);
}
