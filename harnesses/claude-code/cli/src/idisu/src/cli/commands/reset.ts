import { rmSync, existsSync, mkdirSync } from 'node:fs'
import { STATE_DIR, CACHE_DIR } from '../../paths.js'

export function cmdReset(args: string[]): void {
  const projectionsOnly = args.includes('--projections-only')

  if (existsSync(STATE_DIR)) {
    rmSync(STATE_DIR, { recursive: true })
    mkdirSync(STATE_DIR, { recursive: true })
    console.log('[idisu] Cleared state/ (projections reset).')
  }
  if (!projectionsOnly && existsSync(CACHE_DIR)) {
    rmSync(CACHE_DIR, { recursive: true })
    mkdirSync(CACHE_DIR, { recursive: true })
    console.log('[idisu] Cleared cache/ (SQLite index reset).')
  }
  console.log('[idisu] Event log in events/ is untouched — projections will rebuild on next dream.')
}
