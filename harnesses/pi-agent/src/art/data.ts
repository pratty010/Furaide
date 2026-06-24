export const MODES = [
  "STARK NEON",
  "DIAGNOSTIC",
  "NEURAL LINK",
  "COMBAT READY",
  "RESEARCH MODE",
  "STEALTH OPS",
  "OVERCLOCK",
  "HEURISTIC AI",
  "ARC REACTOR",
  "PROTOCOLS",
  "AUTOPILOT",
  "QUANTUM MODE",
  "SANDBOX",
  "WATCHTOWER",
  "GENESIS",
] as const;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function pickMode(): (typeof MODES)[number] {
  return pick(MODES);
}
