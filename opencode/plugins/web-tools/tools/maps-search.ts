import type { MapsSearchConfig, ResultMetadata } from "../types.ts";
import { errorSink } from "../util/error-sink.ts";

export interface MapsSearchArgs {
  query: string;
  lat?: number;
  lng?: number;
  count?: number;
}

export interface NormalizedMapsSearchRequest {
  query: string;
  count: number;
}

export interface MapsSearchResultItem {
  title: string;
  uri: string;
  placeId?: string;
}

export interface MapsProviderResult {
  results: MapsSearchResultItem[];
  metadata: ResultMetadata;
}

export interface MapsSearchPublicResult {
  results: MapsSearchResultItem[];
}

export interface MapsSearchRuntime {
  config: { mapsSearch: MapsSearchConfig };
  usage: {
    recordFromSearch(metadata: MapsProviderResult["metadata"]): Promise<void>;
  };
  providers: {
    searchMaps(request: NormalizedMapsSearchRequest & { lat?: number; lng?: number }): Promise<MapsProviderResult>;
  };
  recordWithBudget(provider: string, metadata: { unitsUsed?: number; tokensInput?: number; tokensOutput?: number; estimatedCostUsd?: number }): Promise<string | null>;
}

export function normalizeMapsSearchArgs(args: MapsSearchArgs, config: MapsSearchConfig): NormalizedMapsSearchRequest {
  return {
    query: args.query,
    count: args.count ?? config.count,
  };
}

export function toPublicMapsResult(item: MapsSearchResultItem): MapsSearchResultItem {
  const result: MapsSearchResultItem = { title: item.title, uri: item.uri };
  if (item.placeId !== undefined) result.placeId = item.placeId;
  return result;
}

export async function executeMapsSearchTool(args: MapsSearchArgs, runtime: MapsSearchRuntime): Promise<MapsSearchPublicResult> {
  const request = normalizeMapsSearchArgs(args, runtime.config.mapsSearch);
  const result = await runtime.providers.searchMaps({
    query: request.query,
    count: request.count,
    lat: args.lat,
    lng: args.lng,
  });
  runtime.usage.recordFromSearch(result.metadata).catch(errorSink("maps_search record"));
  const preamble = await runtime.recordWithBudget(result.metadata.provider, result.metadata);
  const publicResult: MapsSearchPublicResult = {
    results: result.results.map(toPublicMapsResult),
  };
  if (preamble) (publicResult as Record<string, unknown>)._warning = preamble;
  return publicResult;
}
