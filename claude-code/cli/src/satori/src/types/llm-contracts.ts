import { z } from 'zod'

export const PatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('keep'),      id: z.string() }),
  z.object({ op: z.literal('update'),    id: z.string(), patch: z.record(z.unknown()), evidence_ids: z.array(z.string()) }),
  z.object({ op: z.literal('supersede'), old_id: z.string(), new_item: z.unknown(), evidence_ids: z.array(z.string()) }),
  z.object({ op: z.literal('new'),       item: z.unknown(), evidence_ids: z.array(z.string()) }),
  z.object({ op: z.literal('drop'),      id: z.string(), reason: z.string() }),
])
export type PatchOp = z.infer<typeof PatchOpSchema>

export const IntentClusterNameResponseSchema = z.object({
  cluster_id: z.string(),
  name:       z.string().max(60),
  confidence: z.number().min(0).max(1),
})

export const GapConfirmationResponseSchema = z.object({
  capability_id:    z.string(),
  confirmed:        z.boolean(),
  finding_type:     z.enum(['underused', 'gap', 'misfire', 'redundant']),
  severity:         z.enum(['low', 'medium', 'high']),
  summary:          z.string().max(200),
  counter_evidence: z.array(z.string()).default([]),
  confidence:       z.number().min(0).max(1),
})

export const ProfilePatchResponseSchema = z.object({
  patch_ops:  z.array(PatchOpSchema),
  token_used: z.number().int().nonnegative(),
})

export const BacklogItemResponseSchema = z.object({
  patch_ops:  z.array(PatchOpSchema),
  token_used: z.number().int().nonnegative(),
})
