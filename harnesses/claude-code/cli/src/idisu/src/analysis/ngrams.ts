export interface NgramResult {
  signature: string;
  frequency: number;
  sessionCount: number;
}

export function extractNgrams(
  toolSequences: string[][],
  opts: { min: number; n: number },
): NgramResult[] {
  const { min, n } = opts;

  // Guard against invalid n values
  if (n <= 0 || !Number.isInteger(n)) {
    return [];
  }

  // Track ngrams: signature -> { frequency, sessionIndices (set) }
  const ngramMap = new Map<
    string,
    { frequency: number; sessionSet: Set<number> }
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
        ngramMap.set(signature, { frequency: 0, sessionSet: new Set() });
      }

      const entry = ngramMap.get(signature);
      if (entry) {
        entry.frequency += 1;
        entry.sessionSet.add(sessionIndex);
      }
    }
  });

  // Filter by min threshold and build result
  const results: NgramResult[] = [];
  for (const [signature, { frequency, sessionSet }] of ngramMap.entries()) {
    if (frequency >= min) {
      results.push({
        signature,
        frequency,
        sessionCount: sessionSet.size,
      });
    }
  }

  return results;
}
