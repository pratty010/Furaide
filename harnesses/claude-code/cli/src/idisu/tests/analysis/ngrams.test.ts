import { expect, test } from "bun:test";
import { extractNgrams } from "../../src/analysis/ngrams.js";

test("extractNgrams finds a 3-tool sequence repeated across sessions", () => {
  const seqs = [
    ["Read", "Edit", "Bash"],
    ["Read", "Edit", "Bash"],
    ["Grep", "Read"],
  ];
  const grams = extractNgrams(seqs, { min: 2, n: 3 });
  expect(grams.find((g) => g.signature === "Read>Edit>Bash")?.frequency).toBe(
    2,
  );
});

test("extractNgrams tracks sessionCount separately from frequency", () => {
  const seqs = [
    ["Read", "Edit", "Bash"],
    ["Read", "Edit", "Bash"],
    ["Grep", "Read"],
  ];
  const grams = extractNgrams(seqs, { min: 2, n: 3 });
  const readEditBash = grams.find((g) => g.signature === "Read>Edit>Bash");
  expect(readEditBash).toBeDefined();
  expect(readEditBash?.frequency).toBe(2);
  expect(readEditBash?.sessionCount).toBe(2);
});

test("extractNgrams counts multiple occurrences within a single session", () => {
  const seqs = [["A", "B", "C", "A", "B", "C"]];
  const grams = extractNgrams(seqs, { min: 2, n: 2 });
  const ab = grams.find((g) => g.signature === "A>B");
  expect(ab?.frequency).toBe(2);
  expect(ab?.sessionCount).toBe(1);
});

test("extractNgrams filters by min threshold", () => {
  const seqs = [
    ["X", "Y", "Z"],
    ["A", "B", "C"],
  ];
  const grams = extractNgrams(seqs, { min: 2, n: 3 });
  expect(grams).toHaveLength(0);
});

test("extractNgrams handles sequences shorter than n", () => {
  const seqs = [["A", "B"], ["C"]];
  const grams = extractNgrams(seqs, { min: 1, n: 3 });
  expect(grams).toHaveLength(0);
});

test("extractNgrams returns empty array for empty input", () => {
  const grams = extractNgrams([], { min: 1, n: 2 });
  expect(grams).toHaveLength(0);
});

test("extractNgrams ignores invalid n values", () => {
  const seqs = [["A", "B", "C"]];
  expect(extractNgrams(seqs, { min: 1, n: 0 })).toHaveLength(0);
  expect(extractNgrams(seqs, { min: 1, n: -1 })).toHaveLength(0);
});
