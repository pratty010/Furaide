import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../../paths.js'
import { BacklogItemSchema } from '../../types/projections.js'

export function cmdImprove(args: string[]): void {
  const capId = args[0]
  if (!capId) {
    console.error('Usage: idisu improve <capability-id>')
    process.exit(1)
  }

  const path = join(STATE_DIR, 'backlog.jsonl')
  if (!existsSync(path)) {
    console.error('[idisu] No backlog found. Run `idisu dream` first.')
    process.exit(1)
  }

  const items = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try {
      return [BacklogItemSchema.parse(JSON.parse(l))]
    } catch {
      return []
    }
  }).filter(i => i.capability_id === capId && i.status === 'open')

  if (items.length === 0) {
    console.log(`[idisu] No open backlog items for capability: ${capId}`)
    return
  }

  for (const item of items) {
    console.log(`── ${item.type} (${item.item_id.slice(0, 8)}) ──`)
    console.log(`Title:  ${item.title}`)
    console.log(`Route:  ${item.route}`)
    console.log(`Brief:\n${item.brief}`)
    console.log()
  }
  console.log('[idisu] Hand the brief above to `skill-creator` or `writing-skills`.')
  console.log(`         After applying, run: idisu mark ${capId} accepted`)
}
