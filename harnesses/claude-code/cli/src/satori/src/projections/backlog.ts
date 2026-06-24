import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../paths.js'
import type { BacklogItem } from '../types/projections.js'
import { createHash } from 'node:crypto'

export function appendBacklogItem(item: BacklogItem): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  appendFileSync(join(STATE_DIR, 'backlog.jsonl'), `${JSON.stringify(item)}\n`)
}

export function makeBacklogItemId(capabilityId: string, type: string, ts: string): string {
  return createHash('sha256').update(`${capabilityId}:${type}:${ts}`).digest('hex').slice(0, 16)
}
