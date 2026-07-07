import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR, CATALOG_DIR, STATE_MANIFEST } from '../paths.js'
import { StateManifestSchema, type StateManifest } from '../types/projections.js'
import { CatalogSnapshotSchema, type CatalogSnapshot } from '../types/catalog.js'

export interface OrientResult {
  manifest: StateManifest | null
  catalogSnapshot: CatalogSnapshot | null
  profileExists: boolean
  backlogCount: number
  findingsCount: number
}

export function orient(): OrientResult {
  let manifest: StateManifest | null = null
  if (existsSync(STATE_MANIFEST)) {
    try {
      manifest = StateManifestSchema.parse(JSON.parse(readFileSync(STATE_MANIFEST, 'utf8')))
    } catch {
      console.warn('[satori/orient] invalid manifest — will rebuild from scratch')
    }
  }

  let catalogSnapshot: CatalogSnapshot | null = null
  if (existsSync(CATALOG_DIR)) {
    const files = readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json')).sort().reverse()
    if (files[0]) {
      try {
        catalogSnapshot = CatalogSnapshotSchema.parse(
          JSON.parse(readFileSync(join(CATALOG_DIR, files[0]), 'utf8')),
        )
      } catch {
        console.warn('[satori/orient] invalid catalog snapshot')
      }
    }
  }

  const profilePath = join(STATE_DIR, 'profile.md')
  const backlogPath = join(STATE_DIR, 'backlog.jsonl')
  const findingsPath = join(STATE_DIR, 'findings.jsonl')

  const countLines = (path: string) => {
    if (!existsSync(path)) return 0
    return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).length
  }

  return {
    manifest,
    catalogSnapshot,
    profileExists: existsSync(profilePath),
    backlogCount: countLines(backlogPath),
    findingsCount: countLines(findingsPath),
  }
}
