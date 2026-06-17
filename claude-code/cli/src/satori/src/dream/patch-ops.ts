import type { PatchOp } from '../types/llm-contracts.js'

export function applyPatchOps<T extends Record<string, unknown>>(
  items: T[],
  ops: PatchOp[],
  idFn: (item: T) => string,
): T[] {
  const map = new Map<string, T>(items.map(i => [idFn(i), i]))
  const newItems: T[] = []

  for (const op of ops) {
    switch (op.op) {
      case 'keep':
        break
      case 'update': {
        const existing = map.get(op.id)
        if (existing) map.set(op.id, { ...existing, ...op.patch } as T)
        break
      }
      case 'supersede': {
        const existing = map.get(op.old_id)
        if (existing) map.set(op.old_id, { ...existing, status: 'superseded' } as T)
        newItems.push(op.new_item as T)
        break
      }
      case 'new':
        newItems.push(op.item as T)
        break
      case 'drop': {
        const existing = map.get(op.id)
        if (existing) map.set(op.id, { ...existing, status: 'superseded' } as T)
        break
      }
    }
  }

  return [...map.values(), ...newItems]
}
