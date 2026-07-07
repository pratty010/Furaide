import { z } from 'zod'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import { CHECKPOINTS_FILE } from '../paths.js'

export const CheckpointSchema = z.object({
  source_id:                   z.string(),
  inode:                       z.number().int().optional(),
  size:                        z.number().int().optional(),
  mtime:                       z.number().optional(),
  prefix_hash:                 z.string().optional(),
  last_complete_line_offset:   z.number().int().nonnegative(),
  last_event_id:               z.string().optional(),
  last_scanned_at:             z.string().datetime(),
})
export type Checkpoint = z.infer<typeof CheckpointSchema>

export type CheckpointMap = Map<string, Checkpoint>

export function loadCheckpoints(path: string = CHECKPOINTS_FILE): CheckpointMap {
  if (!existsSync(path)) return new Map()
  const raw: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'))
  const map = new Map<string, Checkpoint>()
  for (const [k, v] of Object.entries(raw)) {
    map.set(k, CheckpointSchema.parse(v))
  }
  return map
}

export function saveCheckpoint(
  map: CheckpointMap,
  ck: Checkpoint,
  path: string = CHECKPOINTS_FILE,
): void {
  map.set(ck.source_id, ck)
  const dir = dirname(path)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const obj: Record<string, Checkpoint> = {}
  for (const [k, v] of map.entries()) obj[k] = v
  writeFileSync(path, JSON.stringify(obj, null, 2))
}

export function getCheckpoint(map: CheckpointMap, sourceId: string): Checkpoint | undefined {
  return map.get(sourceId)
}

export function computePrefixHash(prefix: string): string {
  return createHash('sha256').update(prefix).digest('hex').slice(0, 16)
}

export function shouldRescan(
  ck: Checkpoint | undefined,
  inode: number,
  size: number,
  mtime: number,
): boolean {
  if (!ck) return true
  if (ck.inode !== inode || ck.mtime !== mtime) return true
  if (ck.size !== undefined && size > ck.size) return true
  return false
}
