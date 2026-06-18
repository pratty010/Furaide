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

    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }

    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }

  return out;
}

export function hasControlBytes(input: unknown): boolean {
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(String(input ?? ""));
}

export function capText(input: unknown, max: number): string {
  const text = renderSafe(input);
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}