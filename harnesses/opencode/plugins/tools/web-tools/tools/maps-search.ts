import type { MapsSearchConfig, ResultMetadata } from "../types.ts";
import { clampCount, validateLatLng, validateQuery } from "../util/validate.ts";

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
  _untrusted?: true;
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
  const query = validateQuery(args.query);
  return {
    query,
    count: clampCount(args.count, config.count),
  };
}

export function validateMapsSearchLatLng(args: MapsSearchArgs): { lat?: number; lng?: number } {
  return validateLatLng(args.lat, args.lng);
}

export function toPublicMapsResult(item: MapsSearchResultItem): MapsSearchResultItem {
  const result: MapsSearchResultItem = { title: item.title, uri: item.uri, _untrusted: true };
  if (item.placeId !== undefined) result.placeId = item.placeId;
  return result;
}

export async function executeMapsSearchTool(args: MapsSearchArgs, runtime: MapsSearchRuntime): Promise<MapsSearchPublicResult> {
  const request = normalizeMapsSearchArgs(args, runtime.config.mapsSearch);
  const coords = validateMapsSearchLatLng(args);
  const result = await runtime.providers.searchMaps({
    query: request.query,
    count: request.count,
    lat: coords.lat,
    lng: coords.lng,
  });
  const preamble = await runtime.recordWithBudget(result.metadata.provider, result.metadata);
  const publicResult: MapsSearchPublicResult = {
    results: result.results.map(toPublicMapsResult),
  };
  if (preamble) (publicResult as Record<string, unknown>)._warning = preamble;
  return publicResult;
}
