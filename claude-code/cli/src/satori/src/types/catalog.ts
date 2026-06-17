import { z } from 'zod'
import { HarnessSchema } from './events.js'

export const CapabilityDefinitionSchema = z.object({
  capability_id:  z.string(),
  name:           z.string(),
  description:    z.string(),
  harness:        HarnessSchema,
  type:           z.enum(['skill', 'agent', 'command', 'plugin']),
  path:           z.string(),
  content_hash:   z.string(),
  trigger_hints:  z.array(z.string()).default([]),
  scanned_at:     z.string().datetime(),
})
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>

export const CatalogSnapshotSchema = z.object({
  harness:        HarnessSchema,
  snapshotted_at: z.string().datetime(),
  capabilities:   z.array(CapabilityDefinitionSchema),
})
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>
