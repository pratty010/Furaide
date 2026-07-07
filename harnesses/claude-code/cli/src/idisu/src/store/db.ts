import { Database } from "bun:sqlite";
import { SCHEMA_SQL, FTS_SQL, SCHEMA_VERSION } from "./schema.js";

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  // FTS5 is compiled into Bun's Linux SQLite; guard so a build without it
  // degrades to non-search rather than crashing the whole engine.
  try { db.exec(FTS_SQL); } catch { /* FTS unavailable — search features no-op */ }
  const cur = (db.query("PRAGMA user_version").get() as any).user_version as number;
  if (cur < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}
