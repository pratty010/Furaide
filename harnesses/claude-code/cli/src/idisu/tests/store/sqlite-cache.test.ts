import { test, expect, afterAll } from 'bun:test'
import { rmSync, existsSync } from 'fs'
import { ĪdisuCache } from '../../src/store/sqlite-cache.js'

const DB_PATH = '/tmp/idisu-cache-test.sqlite'

afterAll(() => { if (existsSync(DB_PATH)) rmSync(DB_PATH) })

test('ĪdisuCache initializes and upserts a capability without error', () => {
  const cache = new ĪdisuCache(DB_PATH)
  expect(() => cache.upsertCapability({
    capability_id: 'brainstorming',
    name:          'Brainstorming',
    description:   'Explores user intent before building',
    harness:       'claude_code',
    type:          'skill',
    path:          '/skills/brainstorming/SKILL.md',
    content_hash:  'abc123',
    trigger_hints: ['create', 'feature'],
    scanned_at:    '2026-06-17T10:00:00Z',
  })).not.toThrow()
  cache.close()
})

test('ĪdisuCache BM25 search returns brainstorming for relevant query', () => {
  const cache = new ĪdisuCache(DB_PATH)
  const results = cache.bm25Search('brainstorm feature design', 5)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]?.capability_id).toBe('brainstorming')
  cache.close()
})
