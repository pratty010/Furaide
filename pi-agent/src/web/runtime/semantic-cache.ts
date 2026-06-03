import type { KnowledgeDB, QueryRow } from "./db.ts";
import type { Embedder } from "./embedder.ts";
import { embeddingCache, queryCache } from "./lru-cache.ts";

export type LookupResult =
  | { kind: "l1_hit"; result: unknown }
  | { kind: "hard"; similarity: number; queryHash: string }
  | { kind: "soft"; similarity: number; queryHash: string }
  | { kind: "miss" };

export type StoreResult =
  | { kind: "inserted"; queryHash: string }
  | { kind: "extended"; queryHash: string }
  | { kind: "skipped" };

export interface SemanticCacheOptions {
  enabled?: boolean;
  hardThreshold: number;
  softThreshold: number;
  dedupThreshold?: number; // default 0.98
}

export class SemanticCache {
  constructor(
    private readonly db: KnowledgeDB,
    private readonly embedder: Embedder,
    private readonly opts: SemanticCacheOptions,
  ) {}

  private async embed(text: string): Promise<Float32Array> {
    const cached = embeddingCache.get(text);
    if (cached) return cached;
    const vec = await this.embedder.embed(text);
    embeddingCache.set(text, vec);
    return vec;
  }

  async lookup(tool: string, queryText: string): Promise<LookupResult> {
    if (this.opts.enabled === false) {
      this.db.recordHit(tool, "miss");
      return { kind: "miss" };
    }

    const l1Key = `${tool}:${queryText}`;
    const cached = queryCache.get(l1Key);
    if (cached !== undefined) {
      let result_count: number | undefined;
      if (Array.isArray(cached)) {
        result_count = (cached as unknown[]).length;
      } else if (
        cached &&
        typeof cached === "object" &&
        "results" in (cached as Record<string, unknown>) &&
        Array.isArray((cached as Record<string, unknown>).results)
      ) {
        result_count = ((cached as Record<string, unknown>).results as unknown[]).length;
      }

      this.db.recordHit(tool, "l1_hit", { result_count });
      return { kind: "l1_hit", result: cached };
    }

    let vec: Float32Array;
    try {
      vec = await this.embed(queryText);
    } catch {
      this.db.recordHit(tool, "miss");
      return { kind: "miss" };
    }

    const top = this.db.topSimilar(tool, vec, 1);
    if (top.length === 0) {
      this.db.recordHit(tool, "miss");
      return { kind: "miss" };
    }

    const { queryHash, similarity } = top[0]!;
    const row = this.db.getQueryByHash(queryHash);
    
    if (similarity >= this.opts.hardThreshold) {
      this.db.recordHit(tool, "hard", { similarity, provider: row?.provider ?? undefined });
      return { kind: "hard", queryHash, similarity };
    }

    if (similarity >= this.opts.softThreshold) {
      this.db.recordHit(tool, "soft", { similarity, provider: row?.provider ?? undefined });
      return { kind: "soft", queryHash, similarity };
    }

    this.db.recordHit(tool, "miss");
    return { kind: "miss" };
  }

  async store(
    q: Omit<QueryRow, "vec" | "vecDims">,
    originalQuery?: string,
    results?: unknown,
  ): Promise<StoreResult> {
    if (this.opts.enabled === false) return { kind: "skipped" };

    let vec: Float32Array | null = null;
    let vecDims: number | null = null;
    try {
      vec = await this.embed(q.queryText);
      vecDims = vec.length;
    } catch {
      /* non-fatal: store without vector */
    }

    const dbRow = { ...q, vec, vecDims };
    if (originalQuery !== undefined) {
      dbRow.queryText = originalQuery;
    }

    const res = this.db.insertQueryIfNovel(
      dbRow,
      this.opts.dedupThreshold ?? 0.98,
    );

    if (results !== undefined) {
      const tool = q.tool;
      const queryText = q.queryText;
      queryCache.set(`${tool}:${queryText}`, results);
      if (originalQuery !== undefined && originalQuery !== q.queryText) {
        queryCache.set(`${tool}:${originalQuery}`, results);
      }
    }

    return res;
  }
}
