#!/usr/bin/env bun
import { cmdDream } from './commands/dream.js'
import { cmdProfile } from './commands/profile.js'
import { cmdReport } from './commands/report.js'
import { cmdReset } from './commands/reset.js'
import { cmdPromote } from './commands/promote.js'
import { cmdReject } from './commands/reject.js'
import { cmdReview } from './commands/review.js'
import { cmdLearn } from './commands/learn.js'

const [, , subcommand, ...rest] = process.argv

const commands: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  dream: cmdDream,
  profile: cmdProfile,
  report: cmdReport,
  reset: cmdReset,
  promote: cmdPromote,
  reject: cmdReject,
  review: cmdReview,
  learn: cmdLearn,
}

if (!subcommand || subcommand === '--help' || subcommand === 'help') {
  console.log(`Īdisu (覚) — Capability analytics for Claude Code and friends

Usage: idisu <command> [options]

Commands:
  dream    [--force]                       Run dream pass (collect + consolidate)
  profile  [--json]                        Print work-style profile
  report   [--serve]                       Generate HTML report (--serve opens browser)
  review   [--json]                        List candidates pending review (read-only)
  promote  <id> --to <path>                Move a staged candidate into an installed skill
  reject   <id> --reason "<text>"          Archive a staged candidate, record rejection memory
  learn    --source <dir|file|url|sess>    Assemble evidence + standards into a skill-authoring prompt
  reset    [--projections-only]            Clear state (event log preserved)
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
