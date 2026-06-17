export interface GapCandidate {
  capability_id: string
  bm25_rank: number
  fired: boolean
  candidate_type: 'underused' | 'not_fired'
}

export function generateGapCandidates(
  promptTerms: string[],
  firingCapabilities: Set<string>,
  bm25Results: Array<{ capability_id: string; rank: number }>,
  topK = 5,
): GapCandidate[] {
  void promptTerms
  return bm25Results
    .slice(0, topK)
    .filter(r => !firingCapabilities.has(r.capability_id))
    .map(r => ({
      capability_id: r.capability_id,
      bm25_rank: r.rank,
      fired: false,
      candidate_type: firingCapabilities.size === 0 ? 'not_fired' : 'underused',
    }))
}

export function buildGapAdjudicationPrompt(
  candidates: GapCandidate[],
  promptExcerpt: string,
  capabilityDescriptions: Map<string, string>,
): string {
  const lines = candidates.map(c => {
    const desc = capabilityDescriptions.get(c.capability_id) ?? '(no description)'
    return `- ${c.capability_id}: ${desc}`
  })
  return [
    'You are reviewing whether the user missed relevant capabilities during a session.',
    '',
    `Session context (excerpt): "${promptExcerpt}"`,
    '',
    'Capability candidates that did NOT fire (BM25-ranked):',
    ...lines,
    '',
    'For each candidate, output JSON conforming to GapConfirmationResponseSchema:',
    '{ capability_id, confirmed: bool, finding_type, severity, summary, counter_evidence[], confidence }',
    'Respond with a JSON array only. No prose.',
  ].join('\n')
}
