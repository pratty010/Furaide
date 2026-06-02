"use strict";
/**
 * Brand Builder Calibration Regression Tests
 *
 * Loads the 3 anchor fixtures (not real-profile — that is manual),
 * runs the calibration harness programmatically, and asserts all
 * dimension scores fall within their target bands.
 *
 * These tests act as a regression guard: if engine weights change and
 * a fixture fails its band, this test will catch it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { runCalibration, loadFixtures } = require("../calibration/harness.js");

// ---------------------------------------------------------------------------
// Load anchor fixtures only (exclude real-profile — skip_if_missing handles it
// but we exclude it explicitly to keep calibration tests deterministic)
// ---------------------------------------------------------------------------

const ANCHOR_FIXTURE_NAMES = ["anchor-weak", "anchor-mid", "anchor-strong"];

function loadAnchorFixtures() {
  const fixtureDir = path.resolve(__dirname, "../calibration/fixtures");
  const all = loadFixtures(fixtureDir);
  return all.filter((f) => ANCHOR_FIXTURE_NAMES.includes(f.name));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("calibration", () => {
  const fixtures = loadAnchorFixtures();

  it("loads all 3 anchor fixtures", () => {
    assert.strictEqual(fixtures.length, 3, `Expected 3 anchor fixtures, got ${fixtures.length}`);
  });

  it("anchor-weak: all dimensions within target bands", () => {
    const result = runCalibration(fixtures.filter((f) => f.name === "anchor-weak"));
    assert.strictEqual(result.length, 1);
    const r = result[0];
    assert.strictEqual(r.skipped, false, "anchor-weak should not be skipped");
    assert.strictEqual(r.pass, true,
      `anchor-weak FAILED:\n${r.dimensions.map((d) =>
        `  ${d.dimension}: actual=${d.actual} band=${d.targetBand} pass=${d.pass}`
      ).join("\n")}`
    );
  });

  it("anchor-mid: all dimensions within target bands", () => {
    const result = runCalibration(fixtures.filter((f) => f.name === "anchor-mid"));
    assert.strictEqual(result.length, 1);
    const r = result[0];
    assert.strictEqual(r.skipped, false, "anchor-mid should not be skipped");
    assert.strictEqual(r.pass, true,
      `anchor-mid FAILED:\n${r.dimensions.map((d) =>
        `  ${d.dimension}: actual=${d.actual} band=${d.targetBand} pass=${d.pass}`
      ).join("\n")}`
    );
  });

  it("anchor-strong: all dimensions within target bands", () => {
    const result = runCalibration(fixtures.filter((f) => f.name === "anchor-strong"));
    assert.strictEqual(result.length, 1);
    const r = result[0];
    assert.strictEqual(r.skipped, false, "anchor-strong should not be skipped");
    assert.strictEqual(r.pass, true,
      `anchor-strong FAILED:\n${r.dimensions.map((d) =>
        `  ${d.dimension}: actual=${d.actual} band=${d.targetBand} pass=${d.pass}`
      ).join("\n")}`
    );
  });

  it("strong profile scores higher than weak profile in all dimensions", () => {
    const strongResults = runCalibration(fixtures.filter((f) => f.name === "anchor-strong"));
    const weakResults = runCalibration(fixtures.filter((f) => f.name === "anchor-weak"));
    const dims = ["signal", "evidence", "visibility", "narrative"];

    const strongDims = Object.fromEntries(
      strongResults[0].dimensions.map((d) => [d.dimension, d.actual])
    );
    const weakDims = Object.fromEntries(
      weakResults[0].dimensions.map((d) => [d.dimension, d.actual])
    );

    for (const dim of dims) {
      assert.ok(
        strongDims[dim] > weakDims[dim],
        `Expected strong.${dim} (${strongDims[dim]}) > weak.${dim} (${weakDims[dim]})`
      );
    }
  });

  it("mid profile scores higher than weak profile in all dimensions", () => {
    const midResults = runCalibration(fixtures.filter((f) => f.name === "anchor-mid"));
    const weakResults = runCalibration(fixtures.filter((f) => f.name === "anchor-weak"));
    const dims = ["signal", "evidence", "visibility", "narrative"];

    const midDims = Object.fromEntries(
      midResults[0].dimensions.map((d) => [d.dimension, d.actual])
    );
    const weakDims = Object.fromEntries(
      weakResults[0].dimensions.map((d) => [d.dimension, d.actual])
    );

    for (const dim of dims) {
      assert.ok(
        midDims[dim] > weakDims[dim],
        `Expected mid.${dim} (${midDims[dim]}) > weak.${dim} (${weakDims[dim]})`
      );
    }
  });

  it("strong profile scores higher than mid profile in all dimensions", () => {
    const strongResults = runCalibration(fixtures.filter((f) => f.name === "anchor-strong"));
    const midResults = runCalibration(fixtures.filter((f) => f.name === "anchor-mid"));
    const dims = ["signal", "evidence", "visibility", "narrative"];

    const strongDims = Object.fromEntries(
      strongResults[0].dimensions.map((d) => [d.dimension, d.actual])
    );
    const midDims = Object.fromEntries(
      midResults[0].dimensions.map((d) => [d.dimension, d.actual])
    );

    for (const dim of dims) {
      assert.ok(
        strongDims[dim] > midDims[dim],
        `Expected strong.${dim} (${strongDims[dim]}) > mid.${dim} (${midDims[dim]})`
      );
    }
  });
});
