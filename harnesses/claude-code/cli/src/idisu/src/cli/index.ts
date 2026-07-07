#!/usr/bin/env bun
import { cmdDream } from './commands/dream.js'
import { cmdProfile } from './commands/profile.js'
import { cmdBacklog } from './commands/backlog.js'
import { cmdReport } from './commands/report.js'
import { cmdImprove } from './commands/improve.js'
import { cmdMark } from './commands/mark.js'
import { cmdReset } from './commands/reset.js'
import { cmdPromote } from './commands/promote.js'
import { cmdReject } from './commands/reject.js'
import { cmdReview } from './commands/review.js'

const [, , subcommand, ...rest] = process.argv

const commands: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  dream: cmdDream,
  profile: cmdProfile,
  backlog: cmdBacklog,
  report: cmdReport,
  improve: cmdImprove,
  mark: cmdMark,
  reset: cmdReset,
  promote: cmdPromote,
  reject: cmdReject,
  review: cmdReview,
}

if (!subcommand || subcommand === '--help' || subcommand === 'help') {
  console.log(`Īdisu (覚) — Capability analytics for Claude Code and friends

Usage: idisu <command> [options]

Commands:
  dream    [--force]                  Run dream pass (collect + consolidate)
  profile  [--json]                   Print work-style profile
  backlog  [--status=open]            List improvement suggestions
  report   [--serve]                  Generate HTML report (--serve opens browser)
  improve  <capability-id>            Print brief for a backlog item
  mark     <id> accepted|rejected     Record outcome of an improvement
  reset    [--projections-only]       Clear state (event log preserved)
  promote  <id> --to <path>           Move a staged candidate into an installed skill
  reject   <id> --reason "<text>"     Archive a staged candidate, record rejection memory
  review   [--json]                   List candidates pending review (read-only)
`)
  process.exit(0)
}

const handler = commands[subcommand]
if (!handler) {
  console.error(`Unknown command: ${subcommand}. Run \`idisu help\` for usage.`)
  process.exit(1)
}

Promise.resolve(handler(rest)).catch(err => {
  console.error('[idisu] Fatal error:', err)
  process.exit(1)
})
