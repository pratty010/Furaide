import { Database } from "bun:sqlite";

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
