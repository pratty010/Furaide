import { homedir } from 'node:os'
import { join } from 'node:path'

export const SATORI_HOME       = process.env.SATORI_HOME ?? join(homedir(), '.satori')
export const EVENTS_DIR        = join(SATORI_HOME, 'events')
export const STATE_DIR         = join(SATORI_HOME, 'state')
export const EVIDENCE_DIR      = join(SATORI_HOME, 'evidence')
export const CATALOG_DIR       = join(SATORI_HOME, 'catalog')
export const CACHE_DIR         = join(SATORI_HOME, 'cache')
export const CHECKPOINTS_FILE  = join(SATORI_HOME, 'checkpoints.json')
export const CONFIG_FILE       = join(SATORI_HOME, 'config.json')
export const SQLITE_CACHE      = join(CACHE_DIR, 'index.sqlite')
export const DREAM_LOCK_FILE   = join(SATORI_HOME, '.dream.lock')
export const LAST_DREAM_FILE   = join(SATORI_HOME, '.last_dream')
export const STATE_MANIFEST    = join(STATE_DIR, 'manifest.json')
