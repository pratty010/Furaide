import { test, expect } from 'bun:test'
import { applyPatchOps } from '../../src/dream/patch-ops.js'
import type { PatchOp } from '../../src/types/llm-contracts.js'

type Item = { id: string; value: string; status: string }

const initial: Item[] = [
  { id: 'a', value: 'old', status: 'open' },
  { id: 'b', value: 'keep', status: 'open' },
]

test('keep op: item survives unchanged', () => {
  const ops: PatchOp[] = [{ op: 'keep', id: 'b' }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  expect(result.find(i => i.id === 'b')?.value).toBe('keep')
})

test('update op: merges patch fields', () => {
  const ops: PatchOp[] = [{ op: 'update', id: 'a', patch: { value: 'updated' }, evidence_ids: ['ev1'] }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  expect(result.find(i => i.id === 'a')?.value).toBe('updated')
})

test('drop op: sets status to superseded (tombstone, no delete)', () => {
  const ops: PatchOp[] = [{ op: 'drop', id: 'a', reason: 'stale' }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  const found = result.find(i => i.id === 'a')
  expect(found?.status).toBe('superseded')
})

test('new op: adds item to collection', () => {
  const ops: PatchOp[] = [{ op: 'new', item: { id: 'c', value: 'fresh', status: 'open' }, evidence_ids: ['ev2'] }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  expect(result.find(i => i.id === 'c')?.value).toBe('fresh')
})
