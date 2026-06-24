import { test, expect } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { loadCheckpoints, saveCheckpoint, getCheckpoint, computePrefixHash, shouldRescan } from '../../src/store/checkpoint.js'

const TMP = '/tmp/satori-ckpt-test'
const TMP_FILE = join(TMP, 'checkpoints.json')

test('loadCheckpoints returns empty map for missing file', () => {
  const ckpts = loadCheckpoints('/nonexistent/checkpoints.json')
  expect(ckpts.size).toBe(0)
})

test('saveCheckpoint + getCheckpoint round-trips correctly', () => {
  mkdirSync(TMP, { recursive: true })
  const ckpts = loadCheckpoints('/nonexistent/checkpoints.json')
  saveCheckpoint(ckpts, {
    source_id:                  'cc:proj/sess',
    inode:                      12345,
    size:                       1024,
    mtime:                      1718600000000,
    prefix_hash:                'abc',
    last_complete_line_offset:  512,
    last_event_id:              'ev001',
    last_scanned_at:            '2026-06-17T10:00:00Z',
  }, TMP_FILE)
  const loaded = loadCheckpoints(TMP_FILE)
  const ck = getCheckpoint(loaded, 'cc:proj/sess')
  expect(ck?.last_complete_line_offset).toBe(512)
  expect(ck?.last_event_id).toBe('ev001')
  rmSync(TMP, { recursive: true })
})

test('computePrefixHash is stable for same content', () => {
  const h1 = computePrefixHash('hello world')
  const h2 = computePrefixHash('hello world')
  expect(h1).toBe(h2)
})

test('shouldRescan returns true when no checkpoint exists', () => {
  expect(shouldRescan(undefined, 1, 100, 999)).toBe(true)
})

test('shouldRescan returns false when inode/mtime/size unchanged', () => {
  const ck = {
    source_id: 'x', inode: 5, size: 100, mtime: 999,
    last_complete_line_offset: 100, last_scanned_at: '2026-06-17T10:00:00Z',
  }
  expect(shouldRescan(ck, 5, 100, 999)).toBe(false)
})
