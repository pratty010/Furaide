#!/usr/bin/env bun
import { cmdDream } from './commands/dream.js'
import { cmdProfile } from './commands/profile.js'
import { cmdBacklog } from './commands/backlog.js'
import { cmdReport } from './commands/report.js'
import { cmdImprove } from './commands/improve.js'
import { cmdMark } from './commands/mark.js'
import { cmdReset } from './commands/reset.js'

const [, , subcommand, ...rest] = process.argv

const commands: Record<string, (args: string[]) => void | Promise<void>> = {
  dream: cmdDream,
  profile: cmdProfile,
  backlog: cmdBacklog,
  report: cmdReport,
  improve: cmdImprove,
  mark: cmdMark,
  reset: cmdReset,
}

if (!subcommand || subcommand === '--help' || subcommand === 'help') {
  console.log(`Satori (覚) — Capability analytics for Claude Code and friends

Usage: satori <command> [options]

Commands:
  dream    [--force]                  Run dream pass (collect + consolidate)
  profile  [--json]                   Print work-style profile
  backlog  [--status=open]            List improvement suggestions
  report   [--serve]                  Generate HTML report (--serve opens browser)
  improve  <capability-id>            Print brief for a backlog item
  mark     <id> accepted|rejected     Record outcome of an improvement
  reset    [--projections-only]       Clear state (event log preserved)
`)
  process.exit(0)
}

const handler = commands[subcommand]
if (!handler) {
  console.error(`Unknown command: ${subcommand}. Run \`satori help\` for usage.`)
  process.exit(1)
}

Promise.resolve(handler(rest)).catch(err => {
  console.error('[satori] Fatal error:', err)
  process.exit(1)
})
