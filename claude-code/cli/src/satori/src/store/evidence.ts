import { z } from 'zod'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { EVIDENCE_DIR } from '../paths.js'

export const EvidenceSnapshotSchema = z.object({
  evidence_id:     z.string(),
  event_id:        z.string(),
  capability_id:   z.string().optional(),
  finding_id:      z.string().optional(),
  excerpt:         z.string().max(300),
  source_pointer:  z.string(),
  snapshotted_at:  z.string().datetime(),
})
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>

export function snapshotEvidence(
  eventId: string,
  sourcePointer: string,
  excerpt: string,
  opts: {
    capabilityId?: string
    findingId?: string
    evidenceDir?: string
  } = {},
): EvidenceSnapshot {
  const { capabilityId, findingId, evidenceDir = EVIDENCE_DIR } = opts
  const evidenceId = createHash('sha256')
    .update(`${eventId}:${excerpt}`)
    .digest('hex')
    .slice(0, 16)
  const snapshot: EvidenceSnapshot = {
    evidence_id:    evidenceId,
    event_id:       eventId,
    capability_id:  capabilityId,
    finding_id:     findingId,
    excerpt:        excerpt.slice(0, 280),
    source_pointer: sourcePointer,
    snapshotted_at: new Date().toISOString(),
  }
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true })
  const path = join(evidenceDir, `${evidenceId}.json`)
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(snapshot, null, 2))
  return snapshot
}

export function loadEvidence(
  evidenceId: string,
  evidenceDir: string = EVIDENCE_DIR,
): EvidenceSnapshot | null {
  const path = join(evidenceDir, `${evidenceId}.json`)
  if (!existsSync(path)) return null
  return EvidenceSnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
