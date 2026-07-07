export interface NgramResult {
  signature: string;
  frequency: number;
  sessionCount: number;
  /**
   * The distinct session IDs (from the optional `sessionIds` param below)
   * that contributed at least one occurrence of this n-gram. Only present
   * when the caller passes `sessionIds` — omitted otherwise so existing
   * index-only callers see no shape change. Added for Phase 5 (Mine, Task
   * 5.1): `mine/mine.ts` needs to know WHICH sessions produced a signature
   * so it can join against `outcome_labels` per session, not just count how
   * many sessions matched.
   */
  sessionIds?: string[];
}

export function extractNgrams(
  toolSequences: string[][],
  opts: { min: number; n: number },
  sessionIds?: string[],
): NgramResult[] {
  const { min, n } = opts;

  // Guard against invalid n values
  if (n <= 0 || !Number.isInteger(n)) {
    return [];
  }

  // Track ngrams: signature -> { frequency, sessionIndices (set), sessionIdSet }
  const ngramMap = new Map<
    string,
    { frequency: number; sessionSet: Set<number>; sessionIdSet: Set<string> }
  >();

  // Process each sequence
  toolSequences.forEach((sequence, sessionIndex) => {
    // Skip sequences shorter than n
    if (sequence.length < n) {
      return;
    }

    // Extract ngrams using sliding window
    for (let i = 0; i <= sequence.length - n; i++) {
      const window = sequence.slice(i, i + n);
      const signature = window.join(">");

      if (!ngramMap.has(signature)) {
        ngramMap.set(signature, {
          frequency: 0,
          sessionSet: new Set(),
          sessionIdSet: new Set(),
        });
      }

      const entry = ngramMap.get(signature);
      if (entry) {
        entry.frequency += 1;
        entry.sessionSet.add(sessionIndex);
        if (sessionIds) {
          const id = sessionIds[sessionIndex];
          if (id !== undefined) entry.sessionIdSet.add(id);
        }
      }
    }
  });

  // Filter by min threshold and build result
  const results: NgramResult[] = [];
  for (const [
    signature,
    { frequency, sessionSet, sessionIdSet },
  ] of ngramMap.entries()) {
    if (frequency >= min) {
      results.push({
        signature,
        frequency,
        sessionCount: sessionSet.size,
        ...(sessionIds ? { sessionIds: [...sessionIdSet] } : {}),
      });
    }
  }

  return results;
}
