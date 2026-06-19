import type { WebSearchPublicResult } from "./tools/web-search.ts";
import type { FetchContentPublicResult } from "./tools/fetch-content.ts";

export class InMemoryCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private webSearchTtlMs: number;
  private fetchContentTtlMs: number;

  constructor(opts?: { webSearchTtlMs?: number; fetchContentTtlMs?: number }) {
    this.webSearchTtlMs = opts?.webSearchTtlMs ?? 3_600_000;
    this.fetchContentTtlMs = opts?.fetchContentTtlMs ?? 86_400_000;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
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
}
