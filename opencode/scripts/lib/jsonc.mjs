/**
 * jsonc.mjs
 * Comment-tolerant JSON parser. Strips // and /* * / comments before
 * handing off to JSON.parse. Preserves "//" and "/*" inside string values
 * (URLs, glob patterns, etc.) by scanning character-by-character rather
 * than relying on regex alone.
 *
 * API:
 *   stripJsoncComments(text) -> string with comments removed
 *   parseJsonc(text)         -> object (or whatever JSON.parse returns)
 *
 * Note: The regex fallback used by merge-config.mjs / unmerge-config.mjs
 * is a fast path that handles 99% of the files in this repo (most of our
 * .jsonc files are valid JSON). This module is the canonical, correct
 * implementation that the two scripts now delegate to.
 */

export function stripJsoncComments(input) {
  let out = '';
  let i = 0;
  const n = input.length;
  let inString = false;
  let stringQuote = '';

  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      // Inside a string: copy verbatim, watch for the matching quote and
      // an escaped quote (\").
      out += ch;
      if (ch === '\\' && i + 1 < n) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      i++;
      continue;
    }

    // Not in a string.
    if (ch === '"' || ch === "'") {
      // Start a string.
      inString = true;
      stringQuote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      // Line comment: skip to end of line (preserve the newline so line
      // numbers stay stable for the parser).
      while (i < n && input[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      // Block comment: skip to closing */.
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripJsoncComments(text));
}
