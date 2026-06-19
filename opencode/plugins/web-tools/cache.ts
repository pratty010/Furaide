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

  getWebSearch(key: string): CachedSearchResult | undefined {
    return this.get<CachedSearchResult>(key);
  }

  setWebSearch(key: string, value: CachedSearchResult): void {
    this.set(key, value, this.webSearchTtlMs);
  }

  getFetchContent(key: string): CachedFetchResult | undefined {
    return this.get<CachedFetchResult>(key);
  }

  setFetchContent(key: string, value: CachedFetchResult): void {
    this.set(key, value, this.fetchContentTtlMs);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
