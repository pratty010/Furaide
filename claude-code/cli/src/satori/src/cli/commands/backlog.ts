import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../../paths.js'
import { BacklogItemSchema } from '../../types/projections.js'

export function cmdBacklog(args: string[]): void {
  const statusFilter = args.find(a => a.startsWith('--status='))?.split('=')[1] ?? 'open'
  const path = join(STATE_DIR, 'backlog.jsonl')
  if (!existsSync(path)) {
    console.log('[satori] No backlog yet. Run `satori dream` first.')
    return
  }

  const items = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try {
      return [BacklogItemSchema.parse(JSON.parse(l))]
    } catch {
      return []
    }
  }).filter(i => i.status === statusFilter)

  if (items.length === 0) {
    console.log(`No ${statusFilter} backlog items.`)
    return
  }
  for (const item of items.sort((a, b) => b.confidence - a.confidence)) {
    console.log(`[${item.item_id.slice(0, 8)}] ${item.type.padEnd(18)} ${item.title}`)
    console.log(`  capability: ${item.capability_id ?? '—'}  confidence: ${(item.confidence * 100).toFixed(0)}%  route: ${item.route}`)
    console.log(`  ${item.brief}`)
    console.log()
  }
}
