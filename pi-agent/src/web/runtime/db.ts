import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { f32ToF16Bytes, f16BytesToF32 } from "./quant.ts";
import { cosine } from "./textsim.ts";

export interface PageRow {
  url: string;
  title?: string | null;
  snippet?: string | null;
  body?: string | null;
  kind: "web" | "video" | "fetch";
  metadata?: string | null;
  provider?: string | null;
  simhash?: string | null;
  contentHash?: string | null;
  fetchedAt?: number | null;
  createdAt?: number;
  expiresAt: number;
}

export interface QueryRow {
  tool: string;
  queryText: string;
  queryHash: string;
  provider: string | null;
  answer: string | null;
  resultUrls: string[];
  vec: Float32Array | null;
  vecDims: number | null;
  expiresAt: number;
}

export type NovelInsertResult =
  | { kind: "inserted"; queryHash: string }
  | { kind: "extended"; queryHash: string };

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS pages (
  url          TEXT PRIMARY KEY,
  title        TEXT,
  snippet      TEXT,
  body         TEXT,
  kind         TEXT NOT NULL,
  metadata     TEXT,
  provider     TEXT,
  simhash      TEXT,
  content_hash TEXT,
  fetched_at   INTEGER,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pages_expires ON pages(expires_at);
CREATE INDEX IF NOT EXISTS pages_simhash ON pages(simhash) WHERE simhash IS NOT NULL;
CREATE INDEX IF NOT EXISTS pages_content_hash ON pages(content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS queries (
  id           INTEGER PRIMARY KEY,
  tool         TEXT NOT NULL,
  query_text   TEXT NOT NULL,
  query_hash   TEXT UNIQUE NOT NULL,
  provider     TEXT,
  answer       TEXT,
  result_urls  TEXT NOT NULL,
  vec_blob     BLOB,
  vec_dims     INTEGER,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS queries_tool_expires ON queries(tool, expires_at);

CREATE TABLE IF NOT EXISTS usage (
  provider    TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  value       REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, period_kind, period_key)
);
`;

const CURRENT_VERSION = 1;

export class KnowledgeDB {
  readonly raw: Database;
  public sessionStatsRing: any[] = [];
  private hitCounts = { l1_hit: 0, hard: 0, soft: 0, miss: 0 };

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.raw = new Database(dbPath, { create: true });
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.init();
  }

  init(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS cache_stats (
        id           INTEGER PRIMARY KEY,
        ts           INTEGER NOT NULL,
        tool         TEXT    NOT NULL,
        outcome      TEXT    NOT NULL,  -- l1_hit | hard | soft | miss
        similarity   REAL,              -- null for l1_hit and exact hits
        provider     TEXT,              -- which provider served (null on hit)
        latency_ms   INTEGER,
        result_count INTEGER,
        tokens_saved INTEGER,
        credits_saved REAL
      );
      CREATE INDEX IF NOT EXISTS cache_stats_ts ON cache_stats(ts);
    `);
  }

  private migrate(): void {
    const row = this.raw
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get();
    const version = row?.user_version ?? 0;
    if (version < 1) this.raw.exec(SCHEMA_V1);
    if (version < CURRENT_VERSION) {
      this.raw.exec(`PRAGMA user_version = ${CURRENT_VERSION}`);
    }
  }

  upsertPage(p: PageRow): void {
    const now = Date.now();
    this.raw
      .query(`
      INSERT INTO pages (url, title, snippet, body, kind, metadata, provider,
                         simhash, content_hash, fetched_at, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title        = COALESCE(excluded.title,        pages.title),
        snippet      = COALESCE(excluded.snippet,      pages.snippet),
        body         = COALESCE(excluded.body,         pages.body),
        kind         = excluded.kind,
        metadata     = COALESCE(excluded.metadata,     pages.metadata),
        provider     = COALESCE(excluded.provider,     pages.provider),
        simhash      = COALESCE(excluded.simhash,      pages.simhash),
        content_hash = COALESCE(excluded.content_hash, pages.content_hash),
        fetched_at   = COALESCE(excluded.fetched_at,   pages.fetched_at),
        expires_at   = MAX(excluded.expires_at,        pages.expires_at)
    `)
      .run(
        p.url,
        p.title ?? null,
        p.snippet ?? null,
        p.body ?? null,
        p.kind,
        p.metadata ?? null,
        p.provider ?? null,
        p.simhash ?? null,
        p.contentHash ?? null,
        p.fetchedAt ?? null,
        p.createdAt ?? now,
        p.expiresAt,
      );
  }

  getPage(url: string): PageRow | null {
    const row = this.raw
      .query<any, [string]>(`
      SELECT url, title, snippet, body, kind, metadata, provider,
             simhash, content_hash AS contentHash, fetched_at AS fetchedAt,
             created_at AS createdAt, expires_at AS expiresAt
      FROM pages WHERE url = ?
    `)
      .get(url);
    return row ?? null;
  }

  insertQuery(q: QueryRow): void {
    const now = Date.now();
    const vecBlob = q.vec ? f32ToF16Bytes(q.vec) : null;
    this.raw
      .query(`
      INSERT INTO queries (tool, query_text, query_hash, provider, answer,
                           result_urls, vec_blob, vec_dims, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(query_hash) DO UPDATE SET
        provider    = excluded.provider,
        answer      = excluded.answer,
        result_urls = excluded.result_urls,
        vec_blob    = excluded.vec_blob,
        vec_dims    = excluded.vec_dims,
        expires_at  = MAX(excluded.expires_at, queries.expires_at)
    `)
      .run(
        q.tool,
        q.queryText,
        q.queryHash,
        q.provider,
        q.answer,
        JSON.stringify(q.resultUrls),
        vecBlob,
        q.vecDims ?? null,
        now,
        q.expiresAt,
      );
  }

  insertQueryIfNovel(q: QueryRow, dedupThreshold: number): NovelInsertResult {
    if (q.vec) {
      const hits = this.topSimilar(q.tool, q.vec, 1);
      if (hits.length && hits[0]!.similarity >= dedupThreshold) {
        const dup = hits[0]!.queryHash;
        this.raw
          .query(
            `UPDATE queries SET expires_at = MAX(expires_at, ?) WHERE query_hash = ?`,
          )
          .run(q.expiresAt, dup);
        return { kind: "extended", queryHash: dup };
      }
    }
    this.insertQuery(q);
    return { kind: "inserted", queryHash: q.queryHash };
  }

  invalidateMismatchedVectors(expectedDims: number): number {
    const r = this.raw
      .query(`DELETE FROM queries WHERE vec_dims IS NOT NULL AND vec_dims != ?`)
      .run(expectedDims);
    return Number(r.changes);
  }

  topSimilar(
    tool: string,
    queryVec: Float32Array,
    k: number,
  ): Array<{ queryHash: string; similarity: number }> {
    const now = Date.now();
    const rows = this.raw
      .query<{ query_hash: string; vec_blob: Uint8Array | null }, [string, number]>(`
      SELECT query_hash, vec_blob FROM queries
      WHERE tool = ? AND expires_at > ? AND vec_blob IS NOT NULL
    `)
      .all(tool, now);
    const scored: Array<{ queryHash: string; similarity: number }> = [];
    for (const r of rows) {
      if (!r.vec_blob) continue;
      const v = f16BytesToF32(r.vec_blob);
      scored.push({ queryHash: r.query_hash, similarity: cosine(queryVec, v) });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  getQueryByHash(
    queryHash: string,
  ): (Omit<QueryRow, "vec"> & { createdAt: number }) | null {
    const r = this.raw
      .query<any, [string]>(`
      SELECT tool, query_text AS queryText, query_hash AS queryHash, provider, answer,
             result_urls AS resultUrlsJson, vec_dims AS vecDims,
             created_at AS createdAt, expires_at AS expiresAt
      FROM queries WHERE query_hash = ?
    `)
      .get(queryHash);
    if (!r) return null;
    return {
      tool: r.tool,
      queryText: r.queryText,
      queryHash: r.queryHash,
      provider: r.provider,
      answer: r.answer,
      resultUrls: JSON.parse(r.resultUrlsJson) as string[],
      vecDims: r.vecDims,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    };
  }

  incrementUsage(
    provider: string,
    periodKind: string,
    periodKey: string,
    delta: number,
  ): number {
    this.raw
      .query(`
    INSERT INTO usage (provider, period_kind, period_key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider, period_kind, period_key) DO UPDATE SET value = value + ?
  `)
      .run(provider, periodKind, periodKey, delta, delta);
    return this.getUsage(provider, periodKind, periodKey);
  }

  getUsage(provider: string, periodKind: string, periodKey: string): number {
    const r = this.raw
      .query<{ value: number }, [string, string, string]>(
        `SELECT value FROM usage WHERE provider = ? AND period_kind = ? AND period_key = ?`,
      )
      .get(provider, periodKind, periodKey);
    return r?.value ?? 0;
  }

  listUsage(
    provider: string,
  ): Array<{
    provider: string;
    periodKind: string;
    periodKey: string;
    value: number;
  }> {
    return this.raw
      .query<any, [string]>(`
    SELECT provider, period_kind AS periodKind, period_key AS periodKey, value
    FROM usage WHERE provider = ? ORDER BY period_key DESC
  `)
      .all(provider);
  }

  recordHit(tool: string, outcome: "l1_hit" | "hard" | "soft" | "miss", metrics: { similarity?: number, provider?: string, latency_ms?: number, result_count?: number, tokens_saved?: number, credits_saved?: number } = {}): void {
    if (this.hitCounts[outcome] !== undefined) {
      this.hitCounts[outcome]++;
    }
    const ts = Date.now();
    const stat = { ts, tool, outcome, ...metrics };
    this.sessionStatsRing.push(stat);
    if (this.sessionStatsRing.length > 1000) {
      this.sessionStatsRing.shift();
    }

    this.raw.run(
      `INSERT INTO cache_stats (ts, tool, outcome, similarity, provider, latency_ms, result_count, tokens_saved, credits_saved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ts,
        tool,
        outcome,
        metrics.similarity ?? null,
        metrics.provider ?? null,
        metrics.latency_ms ?? null,
        metrics.result_count ?? null,
        metrics.tokens_saved ?? null,
        metrics.credits_saved ?? null
      ]
    );
  }

  gc(): void {
    const now = Date.now();
    this.raw.run(`DELETE FROM queries WHERE expires_at < ?`, [now]);
    this.raw.run(`DELETE FROM pages WHERE expires_at < ?`, [now]);
  }

  getCacheStatsSummary(sinceTs: number): {
    hard: number;
    soft: number;
    l1: number;
    miss: number;
    savedUsd: number;
    savedTokens: number;
  } {
    const row = this.raw
      .query<
        {
          hard: number;
          soft: number;
          l1: number;
          miss: number;
          savedUsd: number;
          savedTokens: number;
        },
        [number]
      >(
        `
        SELECT 
          SUM(CASE WHEN outcome = 'hard' THEN 1 ELSE 0 END) as hard,
          SUM(CASE WHEN outcome = 'soft' THEN 1 ELSE 0 END) as soft,
          SUM(CASE WHEN outcome = 'l1_hit' THEN 1 ELSE 0 END) as l1,
          SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) as miss,
          SUM(COALESCE(credits_saved, 0)) as savedUsd,
          SUM(COALESCE(tokens_saved, 0)) as savedTokens
        FROM cache_stats
        WHERE ts >= ?
        `
      )
      .get(sinceTs);

    return {
      hard: row?.hard ?? 0,
      soft: row?.soft ?? 0,
      l1: row?.l1 ?? 0,
      miss: row?.miss ?? 0,
      savedUsd: row?.savedUsd ?? 0,
      savedTokens: row?.savedTokens ?? 0,
    };
  }

  clearSessionStatsRing(): void {
    this.sessionStatsRing.length = 0;
  }

  stats(): {
    pages: number;
    queries: number;
    dbSizeBytes: number;
    oldestEntry: Date | null;
    hitRate: { l1_hit: number; hard: number; soft: number; miss: number };
  } {
    const p = this.raw.query<{ c: number }, []>("SELECT COUNT(*) c FROM pages").get();
    const q = this.raw
      .query<{ c: number }, []>("SELECT COUNT(*) c FROM queries")
      .get();
    const size = this.raw
      .query<{ s: number }, []>(
        "SELECT page_count * page_size AS s FROM pragma_page_count, pragma_page_size",
      )
      .get()?.s;
    const oldRow = this.raw
      .query<{ t: number | null }, []>(
        "SELECT MIN(created_at) AS t FROM (SELECT created_at FROM pages UNION ALL SELECT created_at FROM queries)",
      )
      .get();

    return {
      pages: p?.c ?? 0,
      queries: q?.c ?? 0,
      dbSizeBytes: size ?? 0,
      oldestEntry: oldRow?.t ? new Date(oldRow.t) : null,
      hitRate: { ...this.hitCounts },
    };
  }

  purgeExpired(): number {
    const now = Date.now();
    const tx = this.raw.transaction(() => {
      const a = this.raw
        .query("DELETE FROM pages   WHERE expires_at < ?")
        .run(now).changes;
      const b = this.raw
        .query("DELETE FROM queries WHERE expires_at < ?")
        .run(now).changes;
      return Number(a) + Number(b);
    });
    return tx();
  }

  purgeByTool(tool: string): number {
    const r = this.raw.query("DELETE FROM queries WHERE tool = ?").run(tool);
    return Number(r.changes);
  }

  purgeByUrl(url: string): number {
    const r = this.raw.query("DELETE FROM pages WHERE url = ?").run(url);
    return Number(r.changes);
  }

  purgeByProvider(provider: string): number {
    const r = this.raw
      .query("DELETE FROM pages WHERE provider = ?")
      .run(provider);
    return Number(r.changes);
  }

  purgeByQuery(query: string, tool?: string): number {
    const like = `%${query}%`;
    if (tool) {
      return Number(
        this.raw
          .query("DELETE FROM queries WHERE query_text LIKE ? AND tool = ?")
          .run(like, tool).changes,
      );
    }

    return Number(
      this.raw.query("DELETE FROM queries WHERE query_text LIKE ?").run(like)
        .changes,
    );
  }

  purgeByAge(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const tx = this.raw.transaction(() => {
      const a = this.raw
        .query("DELETE FROM pages   WHERE created_at < ?")
        .run(cutoff).changes;
      const b = this.raw
        .query("DELETE FROM queries WHERE created_at < ?")
        .run(cutoff).changes;
      return Number(a) + Number(b);
    });
    return tx();
  }

  purgeAll(): number {
    const tx = this.raw.transaction(() => {
      const a = this.raw.query("DELETE FROM pages").run().changes;
      const b = this.raw.query("DELETE FROM queries").run().changes;
      const c = this.raw.query("DELETE FROM usage").run().changes;
      return Number(a) + Number(b) + Number(c);
    });
    return tx();
  }

  close(): void {
    this.raw.close();
  }
}
