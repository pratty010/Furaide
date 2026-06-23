import { Database } from "bun:sqlite";
import { hashString } from "./util/hash.ts";
import { normalizeUrl } from "./util/normalize-url.ts";

export function openTestDb(): Database {
  const db = new Database(":memory:");
  createTables(db);
  return db;
}

export function createTables(db: Database): void {
  db.exec(`
    create table if not exists provider_usage (
      provider text not null,
      month text not null,
      calls integer not null default 0,
      units_used real not null default 0,
      estimated_cost_usd real not null default 0,
      tokens_input integer not null default 0,
      tokens_output integer not null default 0,
      warning_80_shown integer not null default 0,
      warning_90_shown integer not null default 0,
      budget_exceeded_shown integer not null default 0,
      suppressed integer not null default 0,
      last_call_at text,
      primary key (provider, month)
    )
  `);

  db.exec(`
    create table if not exists web_search_results (
      url_hash text not null,
      provider text not null,
      normalized_url text not null,
      title text,
      snippet text,
      published text,
      score real,
      content text,
      answer_text text,
      citations_json text,
      highlights_json text,
      fallback_attempted integer not null default 0,
      ignored_args_json text,
      seen_count integer not null default 1,
      first_seen text not null,
      last_seen text not null,
      last_query_hash text,
      primary key (url_hash, provider)
    )
  `);

  db.exec(`
    create table if not exists fetch_content_results (
      url_hash text not null,
      provider text not null,
      mode text not null,
      normalized_url text not null,
      title text,
      content text,
      content_hash text,
      query text,
      depth text,
      format text,
      chunks_count integer,
      pages_crawled integer,
      fallback_attempted integer not null default 0,
      ignored_args_json text,
      seen_count integer not null default 1,
      first_seen text not null,
      last_seen text not null,
      last_query_hash text,
      primary key (url_hash, provider, mode)
    )
  `);
}

interface NormalizedSearchRequest {
  query: string;
  count: number;
  freshness: string;
  rawContent: boolean;
}

interface WebSearchRecordResult {
  results: Array<{ title: string; url: string; snippet: string; published?: string; score?: number; content?: string }>;
  metadata: { provider: string };
}

interface NormalizedFetchContentRequest {
  urls: string[];
  mode: "extract" | "crawl" | "map";
  format: "markdown" | "text";
}

interface FetchContentRecordResult {
  results: Array<{ url: string; title?: string; content?: string }>;
  metadata: { provider: string };
}

export function recordFetchContent(
  db: Database,
  request: NormalizedFetchContentRequest,
  result: FetchContentRecordResult,
): void {
  const stmt = db.prepare(`
    insert into fetch_content_results (url_hash, provider, mode, normalized_url, title, content, format, seen_count, first_seen, last_seen, last_query_hash)
    values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, datetime('now'), datetime('now'), ?8)
    on conflict (url_hash, provider, mode) do update set
      seen_count = seen_count + 1,
      last_seen = datetime('now'),
      title = excluded.title,
      content = excluded.content,
      format = excluded.format
  `);

  const queryHash = hashString(JSON.stringify(request.urls));

  for (const r of result.results) {
    const urlHash = hashString(normalizeUrl(r.url));
    stmt.run(
      urlHash,
      result.metadata.provider,
      request.mode,
      normalizeUrl(r.url),
      r.title ?? null,
      r.content ?? null,
      request.format,
      queryHash,
    );
  }
}

export function recordWebSearch(
  db: Database,
  request: NormalizedSearchRequest,
  result: WebSearchRecordResult,
): void {
  const stmt = db.prepare(`
    insert into web_search_results (url_hash, provider, normalized_url, title, snippet, published, score, content, seen_count, first_seen, last_seen, last_query_hash)
    values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, datetime('now'), datetime('now'), ?9)
    on conflict (url_hash, provider) do update set
      seen_count = seen_count + 1,
      last_seen = datetime('now'),
      title = excluded.title,
      snippet = excluded.snippet,
      published = excluded.published,
      score = excluded.score,
      content = excluded.content
  `);

  const queryHash = hashString(request.query);

  for (const r of result.results) {
    const urlHash = hashString(normalizeUrl(r.url));
    stmt.run(
      urlHash,
      result.metadata.provider,
      normalizeUrl(r.url),
      r.title ?? null,
      r.snippet ?? null,
      r.published ?? null,
      r.score ?? null,
      r.content ?? null,
      queryHash,
    );
  }
}
