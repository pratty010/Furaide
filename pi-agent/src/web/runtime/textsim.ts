// FNV-1a 64-bit hash returned as bigint.
function fnv1a64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ BigInt(s.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function shingles(text: string, k = 3): string[] {
  const toks = tokens(text);
  if (toks.length < k) return toks.length ? [toks.join(" ")] : [];
  const out: string[] = [];
  for (let i = 0; i <= toks.length - k; i++) out.push(toks.slice(i, i + k).join(" "));
  return out;
}

export function simhash64(text: string): bigint {
  const shs = shingles(text);
  if (shs.length === 0) return 0n;
  const counts = new Array<number>(64).fill(0);
  for (const sh of shs) {
    const h = fnv1a64(sh);
    for (let bit = 0; bit < 64; bit++) {
      counts[bit]! += ((h >> BigInt(bit)) & 1n) === 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) if (counts[bit]! > 0) out |= 1n << BigInt(bit);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b,
    c = 0;
  while (x) {
    c += Number(x & 1n);
    x >>= 1n;
  }
  return c;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
