const ESC = "\x1b";
const BEL = "\x07";

function stripUntilTerminator(input: string, start: number): number {
  for (let i = start; i < input.length; i++) {
    if (input[i] === BEL) return i + 1;
    if (input[i] === ESC && input[i + 1] === "\\") return i + 2;
  }
  return input.length;
}

function stripCsi(input: string, start: number): number {
  for (let i = start; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) return i + 1;
  }
  return input.length;
}

export function renderSafe(input: unknown): string {
  const text = String(input ?? "");
  let out = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);

    if (ch === ESC) {
      const next = text[i + 1];
      if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
        i = stripUntilTerminator(text, i + 2) - 1;
        continue;
      }
      if (next === "[") {
        i = stripCsi(text, i + 2) - 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "\n") {
      out += ch;
      continue;
    }
    if (ch === "\t") {
      out += " ";
      continue;
    }

    if (code < 0x20 || code === 0x7f) continue;

    // Filter Unicode Cf (format) and bidi control characters.
    // U+200B–U+2069: zero-width spaces, bidi marks (LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI).
    // U+2028–U+202F: line/paragraph separators and bidi controls.
    // U+FEFF: BOM (zero-width no-break space).
    if (code >= 0x200b && code <= 0x2069) continue;
    if (code >= 0x2028 && code <= 0x202f) continue;
    if (code === 0xfeff) continue;

    out += ch;
  }

  return out;
}

export function hasControlBytes(input: unknown): boolean {
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x00 && code <= 0x08) return true;
    if (code === 0x0b || code === 0x0c) return true;
    if (code >= 0x0e && code <= 0x1f) return true;
    if (code === 0x1b || code === 0x7f) return true;
    if (code >= 0x200b && code <= 0x2069) return true;
    if (code >= 0x2028 && code <= 0x202f) return true;
    if (code === 0xfeff) return true;
  }
  return false;
}

export function capText(input: unknown, max: number): string {
  const text = renderSafe(input);
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}