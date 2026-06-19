interface CachedSearchResult {
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    published?: string;
    score?: number;
    content?: string;
  }>;
}

interface CachedFetchResult {
  results: Array<{
    url: string;
    title?: string;
    content?: string;
  }>;
}

export interface CacheSyncAdapter {
  flush(entries: Array<{ key: string; value: unknown }>): Promise<void>;
}

export const NOOP_SYNC_ADAPTER: CacheSyncAdapter = { async flush() {} };

export class InMemoryCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private webSearchTtlMs: number;
  private fetchContentTtlMs: number;
  private syncIntervalMs: number;
  private syncAdapter: CacheSyncAdapter;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: { webSearchTtlMs?: number; fetchContentTtlMs?: number; syncIntervalMs?: number; syncAdapter?: CacheSyncAdapter }) {
    this.webSearchTtlMs = opts?.webSearchTtlMs ?? 3_600_000;
    this.fetchContentTtlMs = opts?.fetchContentTtlMs ?? 86_400_000;
    this.syncIntervalMs = opts?.syncIntervalMs ?? 300_000;
    this.syncAdapter = opts?.syncAdapter ?? NOOP_SYNC_ADAPTER;
  }

  startSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      const entries: Array<{ key: string; value: unknown }> = [];
      for (const [key, entry] of this.store) {
        if (Date.now() <= entry.expiresAt) {
          entries.push({ key, value: entry.value });
        }
      }
      void this.syncAdapter.flush(entries);
    }, this.syncIntervalMs);
  }

  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
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
