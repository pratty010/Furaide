import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../../paths.js'

export function cmdProfile(args: string[]): void {
  const asJson = args.includes('--json')
  const file = asJson ? join(STATE_DIR, 'profile.json') : join(STATE_DIR, 'profile.md')
  if (!existsSync(file)) {
    console.error('[idisu] No profile found. Run `idisu dream` first.')
    process.exit(1)
  }
  process.stdout.write(readFileSync(file, 'utf8'))
}
