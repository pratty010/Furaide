export interface LastCacheOutcome {
  tool: string;
  outcome: "l1_hit" | "hard" | "soft" | "miss";
  similarity: number | null;
}
let _last: LastCacheOutcome | null = null;
export function setLastCacheOutcome(o: LastCacheOutcome | null): void { _last = o; }
export function getLastCacheOutcome(): LastCacheOutcome | null { return _last; }
