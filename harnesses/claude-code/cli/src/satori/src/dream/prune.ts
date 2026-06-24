import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../paths.js'
import { FindingSchema, BacklogItemSchema } from '../types/projections.js'
import type { Finding, BacklogItem } from '../types/projections.js'

export function pruneAndIndex(retentionDays: number): void {
  const now = new Date()
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString()

  pruneJsonl<Finding>(
    join(STATE_DIR, 'findings.jsonl'),
    FindingSchema,
    item => item.status === 'open' && (!item.expires_at || item.expires_at > cutoff),
  )

  pruneJsonl<BacklogItem>(
    join(STATE_DIR, 'backlog.jsonl'),
    BacklogItemSchema,
    item => item.status === 'open' && (!item.expires_at || item.expires_at > cutoff),
  )
}

function pruneJsonl<T>(
  path: string,
  schema: { parse: (v: unknown) => T },
  keepFn: (item: T) => boolean,
): void {
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim())
  const kept: string[] = []
  for (const line of lines) {
    try {
      const item = schema.parse(JSON.parse(line))
      if (keepFn(item)) kept.push(JSON.stringify(item))
    } catch {}
  }
  writeFileSync(path, kept.join('\n') + (kept.length ? '\n' : ''))
}
