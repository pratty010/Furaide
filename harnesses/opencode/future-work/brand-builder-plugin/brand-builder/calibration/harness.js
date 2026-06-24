"use strict";
/**
 * Calibration harness — runs assessment + role-fit engines over labeled fixtures
 * and reports score-vs-target deltas per dimension.
 *
 * Usage: node calibration/harness.js [--fixture <name>]
 *        bun run calibration/harness.js
 *
 * Exports:
 *   runCalibration(fixtures?) => CalibrationResult[]
 */

const path = require("path");
const fs = require("fs");
const { randomUUID, randomBytes } = require("crypto");
const { Database } = require("bun:sqlite");

let sqliteVec;
try {
  sqliteVec = require("sqlite-vec");
} catch {
  sqliteVec = null;
}

const { createTables } = require("../memory/schema.js");
const { createRepositories } = require("../memory/repository.js");
const { runAssessment } = require("../assess/assessment.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomDigest() {
  return randomBytes(32).toString("hex");
}

/**
 * Create an isolated in-memory DB with schema loaded.
 *
 * @returns {{ db: Database, repos: object }}
 */
function createCalibrationDb() {
  const db = new Database(":memory:");
  if (sqliteVec) {
    sqliteVec.load(db);
  }
  createTables(db);
  const repos = createRepositories(db);
  return { db, repos };
}

/**
 * Seed a fixture into the in-memory DB.
 *
 * @param {object} repos
 * @param {object} fixture — parsed fixture JSON
 */
function seedFixture(repos, fixture) {
  // Map artifact_type → artifactId so we can link summaries
  const artifactIdByType = {};

  for (const art of fixture.artifacts || []) {
    const artifactId = randomUUID();
    const versionId = randomUUID();
    artifactIdByType[art.artifact_type] = { artifactId, versionId };

    repos.artifacts.upsert({
      artifact_id: artifactId,
      artifact_type: art.artifact_type,
      canonical_path: art.canonical_path || `${art.artifact_type}-calibration.txt`,
      raw_digest: randomDigest(),
      normalized_digest: randomDigest(),
      first_ingested_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
      status: "current",
      source_label: `Calibration fixture: ${fixture.name}`,
    });

    repos.versions.create({
      version_id: versionId,
      artifact_id: artifactId,
      version_number: 1,
      canonical_path: art.canonical_path || `${art.artifact_type}-calibration.txt`,
      raw_digest: randomDigest(),
      normalized_digest: randomDigest(),
      ingested_at: new Date().toISOString(),
      provenance: {
        source: "user_upload",
        update_context: `Fixture ${fixture.name}`,
      },
      supersedes_version: null,
    });
  }

  for (const ev of fixture.evidence_summaries || []) {
    const ids = artifactIdByType[ev.artifact_type];
    if (!ids) continue; // skip if no matching artifact

    repos.evidence.create({
      summary_id: randomUUID(),
      artifact_id: ids.artifactId,
      version_id: ids.versionId,
      summary_type: ev.summary_type || "field_extraction",
      content: ev.content || "",
      source_references: [],
      stale: false,
      stale_reason: undefined,
      created_at: new Date().toISOString(),
    });
  }
}

/**
 * Compare actual scores against target bands.
 *
 * @param {object} scores — { signal, evidence, visibility, narrative }
 * @param {object} targetBands — { signal: { min, max }, ... }
 * @returns {DimensionResult[]}
 */
function compareScores(scores, targetBands) {
  const dims = Object.keys(targetBands);
  return dims.map((dim) => {
    const band = targetBands[dim];
    const actual = scores[dim] ?? null;
    const inBand = actual !== null && actual >= band.min && actual <= band.max;
    const delta = actual !== null
      ? (actual < band.min ? actual - band.min : actual > band.max ? actual - band.max : 0)
      : null;
    return {
      dimension: dim,
      targetBand: `${band.min}–${band.max}`,
      actual,
      delta,
      pass: inBand,
    };
  });
}

/**
 * Load all fixture files from the fixtures directory.
 *
 * @param {string} [fixtureDir]
 * @returns {object[]}
 */
function loadFixtures(fixtureDir) {
  const dir = fixtureDir || path.resolve(__dirname, "fixtures");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    return JSON.parse(raw);
  });
}

// ---------------------------------------------------------------------------
// runCalibration — public API (callable from tests)
// ---------------------------------------------------------------------------

/**
 * Run calibration over a list of fixture objects.
 *
 * @param {object[]} [fixtures] — optional override; loads from fixtures/ dir if omitted
 * @returns {CalibrationFixtureResult[]}
 */
function runCalibration(fixtures) {
  const allFixtures = fixtures || loadFixtures();

  const results = [];

  for (const fixture of allFixtures) {
    // Skip fixtures that declare themselves as real-profile checks when artifact files are absent
    if (fixture.skip_if_missing) {
      const checkPath = fixture.real_artifact_check
        ? path.resolve(__dirname, "..", fixture.real_artifact_check)
        : null;
      if (checkPath && !fs.existsSync(checkPath)) {
        results.push({
          name: fixture.name,
          description: fixture.description,
          skipped: true,
          dimensions: [],
          pass: true, // skipped = not a failure
        });
        continue;
      }
    }

    const { repos, db } = createCalibrationDb();

    try {
      seedFixture(repos, fixture);

      const assessment = runAssessment({ repos });
      const scores = {
        signal: assessment.signal,
        evidence: assessment.evidence,
        visibility: assessment.visibility,
        narrative: assessment.narrative,
      };

      const dimensionResults = compareScores(scores, fixture.target_bands);
      const allPass = dimensionResults.every((d) => d.pass);

      results.push({
        name: fixture.name,
        description: fixture.description,
        skipped: false,
        dimensions: dimensionResults,
        pass: allPass,
      });
    } finally {
      db.close();
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI renderer
// ---------------------------------------------------------------------------

function formatTable(results) {
  const rows = [];
  rows.push("\n=== Brand Builder Calibration Report ===\n");

  for (const fixture of results) {
    rows.push(`Fixture: ${fixture.name}`);
    rows.push(`  ${fixture.description || ""}`);

    if (fixture.skipped) {
      rows.push("  [SKIPPED — real artifact file not present]\n");
      continue;
    }

    const status = fixture.pass ? "PASS" : "FAIL";
    rows.push(`  Overall: ${status}\n`);

    const header = "  " + ["Dimension", "Target Band", "Actual", "Delta", "Result"]
      .map((h) => h.padEnd(18))
      .join(" | ");
    rows.push(header);
    rows.push("  " + "-".repeat(header.length - 2));

    for (const d of fixture.dimensions) {
      const delta = d.delta === null ? "n/a" : d.delta === 0 ? "0 (in band)" : String(d.delta);
      const result = d.pass ? "PASS" : "FAIL";
      rows.push(
        "  " +
        [d.dimension, d.targetBand, String(d.actual ?? "n/a"), delta, result]
          .map((v) => v.padEnd(18))
          .join(" | ")
      );
    }
    rows.push("");
  }

  const totalFixtures = results.filter((r) => !r.skipped).length;
  const passedFixtures = results.filter((r) => !r.skipped && r.pass).length;
  rows.push(`Summary: ${passedFixtures}/${totalFixtures} fixtures PASS`);
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  let fixtureFilter = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fixture" && args[i + 1]) {
      fixtureFilter = args[i + 1];
    }
  }

  let fixtures = loadFixtures();
  if (fixtureFilter) {
    fixtures = fixtures.filter((f) => f.name === fixtureFilter);
    if (fixtures.length === 0) {
      console.error(`No fixture named "${fixtureFilter}" found.`);
      process.exit(1);
    }
  }

  const results = runCalibration(fixtures);
  console.log(formatTable(results));

  const anyFail = results.some((r) => !r.skipped && !r.pass);
  process.exit(anyFail ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runCalibration, loadFixtures, seedFixture, compareScores };
