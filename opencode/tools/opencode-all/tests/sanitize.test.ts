import { describe, expect, test } from "bun:test";
import { capText, hasControlBytes, renderSafe } from "../src/sanitize.ts";

describe("renderSafe", () => {
  test("strips OSC 52 clipboard payloads", () => {
    expect(renderSafe("a\x1b]52;c;SGVsbG8=\x07b")).toBe("ab");
  });

  test("strips OSC 0 title spoofing", () => {
    expect(renderSafe("x\x1b]0;FAKE PROMPT\x07y")).toBe("xy");
  });

  test("strips OSC 8 hyperlink wrappers but keeps text", () => {
    expect(renderSafe("\x1b]8;;https://evil.example\x07CLICK\x1b]8;;\x07")).toBe("CLICK");
  });

  test("strips CSI clear screen", () => {
    expect(renderSafe("before\x1b[2Jafter")).toBe("beforeafter");
  });

  test("strips DCS payloads", () => {
    expect(renderSafe("a\x1bP1;2;3+qAAAA\x1b\\b")).toBe("ab");
  });

  test("preserves printable text and newlines, replaces tabs with spaces", () => {
    expect(renderSafe("alpha\tbeta\ngamma")).toBe("alpha beta\ngamma");
  });

  test("removes raw control bytes, replaces tab with space, preserves newline", () => {
    expect(renderSafe("a\x00b\x07c\rd")).toBe("abcd");
    expect(renderSafe("x\ty")).toBe("x y");
  });

  test("strips Unicode bidi override (U+202E RLO)", () => {
    expect(renderSafe("hello\u202eworld")).toBe("helloworld");
  });

  test("strips zero-width spaces (U+200B)", () => {
    expect(renderSafe("a\u200bb")).toBe("ab");
  });

  test("strips BOM (U+FEFF)", () => {
    expect(renderSafe("\ufeffhello")).toBe("hello");
  });
});

describe("hasControlBytes", () => {
  test("detects raw ESC and BEL", () => {
    expect(hasControlBytes("safe")).toBe(false);
    expect(hasControlBytes("bad\x1b[2J")).toBe(true);
    expect(hasControlBytes("bad\x07")).toBe(true);
  });

  test("detects Unicode bidi override characters", () => {
    expect(hasControlBytes("safe")).toBe(false);
    expect(hasControlBytes("bad\u202e")).toBe(true);
    expect(hasControlBytes("bad\u200b")).toBe(true);
    expect(hasControlBytes("bad\ufeff")).toBe(true);
  });
});

describe("capText", () => {
  test("caps long text with ellipsis", () => {
    expect(capText("abcdef", 4)).toBe("abc…");
  });

  test("does not cap short text", () => {
    expect(capText("abc", 4)).toBe("abc");
  });
});