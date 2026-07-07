import { test, expect, afterAll } from 'bun:test'
import { rmSync, existsSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { OpenCodeAdapter } from '../../src/adapters/opencode.js'

const DB_PATH = '/tmp/idisu-opencode-test.db'
afterAll(() => { if (existsSync(DB_PATH)) rmSync(DB_PATH) })

function createTestDb(): void {
  if (existsSync(DB_PATH)) rmSync(DB_PATH)
  const db = new Database(DB_PATH)
  db.run('CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, title TEXT)')
  db.run('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, time INTEGER)')
  db.run(`CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
    time_start INTEGER, time_end INTEGER,
    data TEXT
  )`)
  db.run(`INSERT INTO session VALUES ('oc-sess-001', 1718600000000, 'test session')`)
  db.run(`INSERT INTO message VALUES ('msg-001', 'oc-sess-001', 'assistant', 1718600001000)`)
  const partData = JSON.stringify({ type: 'agent', agent_id: 'code-review', input: {} })
  db.run(`INSERT INTO part VALUES ('part-001', 'msg-001', 'oc-sess-001', 1718600001000, 1718600002000, ?)`, [partData])
  db.close()
}

test('OpenCodeAdapter emits capability.invoked (inferred) for agent part', async () => {
  createTestDb()
  const adapter = new OpenCodeAdapter(DB_PATH)
  const events = []
  for await (const ev of adapter.scan(new Map())) events.push(ev)

  const cap = events.filter(e => e.event_type === 'capability.invoked')
  expect(cap.length).toBeGreaterThan(0)
  const p = cap[0]?.payload as { capability_id: string; observability_level: string; capability_type: string }
  expect(p.capability_id).toBe('code-review')
  expect(p.observability_level).toBe('inferred')
  expect(p.capability_type).toBe('agent')
})
