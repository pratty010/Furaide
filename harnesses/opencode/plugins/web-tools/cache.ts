import type { WebSearchPublicResult } from "./tools/web-search.ts";
import type { FetchContentPublicResult } from "./tools/fetch-content.ts";

export interface InMemoryCacheOptions {
  webSearchTtlMs?: number;
  fetchContentTtlMs?: number;
  maxEntries?: number;
}

export const DEFAULT_MAX_CACHE_ENTRIES = 256;

export class InMemoryCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private webSearchTtlMs: number;
  private fetchContentTtlMs: number;
  private maxEntries: number;

  constructor(opts?: InMemoryCacheOptions) {
    this.webSearchTtlMs = opts?.webSearchTtlMs ?? 3_600_000;
    this.fetchContentTtlMs = opts?.fetchContentTtlMs ?? 86_400_000;
    this.maxEntries = Math.max(1, Math.floor(opts?.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES));
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const entry = { value, expiresAt: Date.now() + ttlMs };
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, entry);
  }

  getWebSearch(key: string): WebSearchPublicResult | undefined {
    return this.get<WebSearchPublicResult>(key);
  }

  setWebSearch(key: string, value: WebSearchPublicResult): void {
    this.set(key, value, this.webSearchTtlMs);
  }

  getFetchContent(key: string): FetchContentPublicResult | undefined {
    return this.get<FetchContentPublicResult>(key);
  }

  setFetchContent(key: string, value: FetchContentPublicResult): void {
    this.set(key, value, this.fetchContentTtlMs);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  get capacity(): number {
    return this.maxEntries;
  }
}
