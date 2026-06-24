// IEEE 754 half-precision conversion.
// float32 -> float16: truncate mantissa (with round-to-nearest-even), clamp exponent.
function f32ToF16(val: number): number {
  const f32 = new Float32Array([val]);
  const bits = new Uint32Array(f32.buffer)[0]!;
  const sign = (bits >>> 16) & 0x8000;
  let exp = ((bits >>> 23) & 0xff) - 127 + 15;
  let mant = bits & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    if (mant & 0x1000) mant += 0x2000;
    return sign | (mant >> 13);
  }
  if (exp >= 0x1f) return sign | 0x7c00 | (mant ? 0x200 : 0);
  if (mant & 0x1000) {
    mant += 0x2000;
    if (mant & 0x800000) {
      mant = 0;
      exp += 1;
    }
    if (exp >= 0x1f) return sign | 0x7c00;
  }
  return sign | (exp << 10) | (mant >> 13);
}

function f16ToF32(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h & 0x7c00) >> 10;
  const mant = h & 0x03ff;
  let bits: number;
  if (exp === 0) {
    if (mant === 0) bits = sign;
    else {
      let m = mant;
      let e = 1;
      while (!(m & 0x400)) {
        m <<= 1;
        e -= 1;
      }
      m &= 0x3ff;
      bits = sign | (((e + 127 - 15) << 23) >>> 0) | (m << 13);
    }
  } else if (exp === 0x1f) {
    bits = sign | 0x7f800000 | (mant << 13);
  } else {
    bits = sign | (((exp + 127 - 15) << 23) >>> 0) | (mant << 13);
  }
  const u = new Uint32Array([bits >>> 0]);
  return new Float32Array(u.buffer)[0]!;
}

export function f32ToF16Bytes(v: Float32Array): Uint8Array {
  const out = new Uint16Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = f32ToF16(v[i]!);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export function f16BytesToF32(b: Uint8Array): Float32Array {
  const u16 = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = f16ToF32(u16[i]!);
  return out;
}
