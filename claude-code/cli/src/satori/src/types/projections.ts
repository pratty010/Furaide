import { z } from 'zod'

export const DecisionStatusSchema = z.enum(['open', 'accepted', 'rejected', 'superseded', 'expired'])
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>

export const FindingSchema = z.object({
  finding_id:       z.string(),
  capability_id:    z.string(),
  type:             z.enum(['underused', 'gap', 'misfire', 'redundant', 'high_friction']),
  severity:         z.enum(['low', 'medium', 'high']),
  diagnostic_tier:  z.enum(['descriptive', 'diagnostic', 'predictive', 'prescriptive']),
  summary:          z.string(),
  evidence_ids:     z.array(z.string()),
  confidence:       z.number().min(0).max(1),
  counter_evidence: z.array(z.string()).default([]),
  status:           DecisionStatusSchema.default('open'),
  created_at:       z.string().datetime(),
  expires_at:       z.string().datetime().optional(),
})
export type Finding = z.infer<typeof FindingSchema>

export const BacklogItemSchema = z.object({
  item_id:        z.string(),
  capability_id:  z.string().optional(),
  type:           z.enum(['new_skill', 'fix_description', 'fix_content', 'retire', 'new_workflow']),
  title:          z.string(),
  brief:          z.string(),
  route:          z.enum(['skill-creator', 'writing-skills', 'manual']),
  evidence_ids:   z.array(z.string()),
  confidence:     z.number().min(0).max(1),
  status:         DecisionStatusSchema.default('open'),
  created_at:     z.string().datetime(),
  expires_at:     z.string().datetime().optional(),
})
export type BacklogItem = z.infer<typeof BacklogItemSchema>

export const IntentClusterSchema = z.object({
  cluster_id:    z.string(),
  name:          z.string(),
  bm25_terms:    z.array(z.string()),
  session_count: z.number().int().nonnegative(),
  last_seen:     z.string().datetime(),
})
export type IntentCluster = z.infer<typeof IntentClusterSchema>

export const StateManifestSchema = z.object({
  schema_version:         z.literal(1),
  built_through_event_id: z.string(),
  built_at:               z.string().datetime(),
  generation:             z.number().int().nonnegative(),
})
export type StateManifest = z.infer<typeof StateManifestSchema>
