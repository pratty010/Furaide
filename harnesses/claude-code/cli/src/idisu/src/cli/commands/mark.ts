import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../../paths.js'
import { BacklogItemSchema, type DecisionStatus } from '../../types/projections.js'

export function cmdMark(args: string[]): void {
  const [capId, rawStatus] = args
  if (!capId || !rawStatus) {
    console.error('Usage: idisu mark <item-id-or-capability-id> accepted|rejected|superseded')
    process.exit(1)
  }

  const status = rawStatus as DecisionStatus
  const validStatuses: DecisionStatus[] = ['accepted', 'rejected', 'superseded', 'expired']
  if (!validStatuses.includes(status)) {
    console.error(`Invalid status: ${status}. Use one of: ${validStatuses.join(', ')}`)
    process.exit(1)
  }

  const path = join(STATE_DIR, 'backlog.jsonl')
  if (!existsSync(path)) {
    console.error('[idisu] No backlog found.')
    process.exit(1)
  }

  let updated = 0
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => {
    try {
      const item = BacklogItemSchema.parse(JSON.parse(l))
      if ((item.capability_id === capId || item.item_id === capId) && item.status === 'open') {
        updated++
        return JSON.stringify({ ...item, status })
      }
      return l
    } catch {
      return l
    }
  })
  writeFileSync(path, `${lines.join('\n')}\n`)
  console.log(`[idisu] Marked ${updated} item(s) as ${status}.`)
}
