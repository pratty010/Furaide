import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint } from '../store/checkpoint.js'
import { makeTypedEvent, type EventEnvelope } from '../types/events.js'

const DEFAULT_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface PartRow {
  rowid: number
  id: string
  message_id: string
  session_id: string
  time_start: number
  data: string
}

export class OpenCodeAdapter implements SessionAdapter {
  readonly harness = 'opencode' as const

  constructor(private readonly dbPath: string = DEFAULT_DB) {}

  async *scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope> {
    if (!existsSync(this.dbPath)) return

    const db = new Database(this.dbPath)
    try {
      const ck = getCheckpoint(checkpoints, `opencode:${this.dbPath}`)
      const lastRowid = ck?.last_complete_line_offset ?? 0

      const rows = db
        .query(`SELECT rowid, id, message_id, session_id, time_start, data FROM part WHERE rowid > ? ORDER BY rowid ASC`)
        .all(lastRowid) as PartRow[]

      for (const row of rows) {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(row.data)
        } catch {
          continue
        }

        if (data.type === 'agent' && typeof data.agent_id === 'string') {
          yield makeTypedEvent('capability.invoked', `opencode:${this.dbPath}`, row.id, 'opencode', {
            session_id: row.session_id,
            turn_index: row.time_start,
            capability_id: data.agent_id,
            capability_type: 'agent',
            harness: 'opencode',
            trigger: 'model',
            observability_level: 'inferred',
            confidence: 0.7,
          })
        } else if (data.type === 'command' && typeof data.command_id === 'string') {
          yield makeTypedEvent('capability.invoked', `opencode:${this.dbPath}`, row.id, 'opencode', {
            session_id: row.session_id,
            turn_index: row.time_start,
            capability_id: data.command_id,
            capability_type: 'command',
            harness: 'opencode',
            trigger: 'user',
            observability_level: 'inferred',
            confidence: 0.8,
          })
        }
      }

      if (rows.length > 0) {
        const lastRow = rows.at(-1)
        if (lastRow) {
          saveCheckpoint(checkpoints, {
            source_id: `opencode:${this.dbPath}`,
            last_complete_line_offset: lastRow.rowid,
            last_scanned_at: new Date().toISOString(),
          })
        }
      }
    } finally {
      db.close()
    }
  }
}
