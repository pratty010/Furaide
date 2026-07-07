import { Database } from 'bun:sqlite'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { CapabilityDefinition } from '../types/catalog.js'
import { SQLITE_CACHE } from '../paths.js'

export class ĪdisuCache {
  private db: Database

  constructor(path: string = SQLITE_CACHE) {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new Database(path)
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA synchronous = NORMAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS capabilities (
        capability_id  TEXT PRIMARY KEY,
        harness        TEXT NOT NULL,
        type           TEXT NOT NULL,
        name           TEXT NOT NULL,
        path           TEXT NOT NULL,
        content_hash   TEXT NOT NULL,
        scanned_at     TEXT NOT NULL
      )
    `)
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS capabilities_fts USING fts5(
        capability_id UNINDEXED,
        name,
        description,
        trigger_hints
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS bm25_event_terms (
        event_id  TEXT NOT NULL,
        term      TEXT NOT NULL,
        PRIMARY KEY (event_id, term)
      )
    `)
  }

  upsertCapability(def: CapabilityDefinition): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO capabilities (capability_id, harness, type, name, path, content_hash, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(capability_id) DO UPDATE SET
           name=excluded.name, path=excluded.path,
           content_hash=excluded.content_hash, scanned_at=excluded.scanned_at`,
        [def.capability_id, def.harness, def.type, def.name, def.path, def.content_hash, def.scanned_at]
      )
      this.db.run(`DELETE FROM capabilities_fts WHERE capability_id = ?`, [def.capability_id])
      this.db.run(
        `INSERT INTO capabilities_fts (capability_id, name, description, trigger_hints)
         VALUES (?, ?, ?, ?)`,
        [def.capability_id, def.name, def.description, def.trigger_hints.join(' ')]
      )
    })()
  }

  bm25Search(query: string, topK: number): Array<{ capability_id: string; rank: number }> {
    // Normalize to prefix OR query so partial terms match (e.g. "brainstorm" → "brainstorming")
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(t => `${t}*`)
      .join(' OR ')
    return this.db.query(
      `SELECT capability_id, rank FROM capabilities_fts WHERE capabilities_fts MATCH ? ORDER BY rank LIMIT ?`
    ).all(ftsQuery, topK) as Array<{ capability_id: string; rank: number }>
  }

  close(): void { this.db.close() }
}
