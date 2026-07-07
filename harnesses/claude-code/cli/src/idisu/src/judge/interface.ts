// Phase 4 (Judge) backend contract.
//
// `JudgeBackend` is the seam an LLM-backed tier (tier2/tier3, later tasks)
// plugs into; `SegmentLabel` is the shape every tier — deterministic or
// LLM — must produce so labels are interchangeable regardless of which tier
// produced them. It mirrors the `outcome_labels` table already defined in
// `store/schema.ts` (Phase 1) field-for-field, so a `SegmentLabel` maps to a
// row with no translation layer.

export interface JudgeBackend {
  label(
    prompt: string,
    model: string,
  ): Promise<"success" | "failure" | "abandoned" | "unknown">;
}

export interface SegmentLabel {
  session_id: string;
  segment_key: string;
  label: string;
  tier: "deterministic" | "llm";
  evidence_ref?: string;
  judge_model?: string;
}
