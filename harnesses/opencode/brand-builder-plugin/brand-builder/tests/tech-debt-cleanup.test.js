const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

const deletedFiles = [
  ".opencode/brand-builder/memory/evidence-store.js",
  ".opencode/brand-builder/snapshots/trigger.js",
  ".opencode/brand-builder/memory/enrichment-gate.js",
  ".opencode/brand-builder/memory/graph-export.js",
  ".opencode/brand-builder/tests/enrichment-gating.test.js",
  ".opencode/brand-builder/tests/surface-optimization-foundation.test.js",
];

describe("tech debt cleanup", () => {
  it("deleted orphan files remain absent", () => {
    for (const filePath of deletedFiles) {
      assert.strictEqual(fs.existsSync(filePath), false, `${filePath} should be deleted`);
    }
  });

  it("surviving tests do not import deleted modules", () => {
    const testFiles = [
      ".opencode/brand-builder/tests/memory-write.test.js",
      ".opencode/brand-builder/tests/snapshots.test.js",
      ".opencode/brand-builder/tests/intake.test.js",
      ".opencode/brand-builder/tests/intake-update.test.js",
      ".opencode/brand-builder/tests/retrieval.test.js",
      ".opencode/brand-builder/tests/assessment.test.js",
      ".opencode/brand-builder/tests/progress-comparison.test.js",
      ".opencode/brand-builder/tests/progress-workflow.test.js",
    ];
    const banned = [
      "../memory/evidence-store.js",
      "../snapshots/trigger.js",
      "../memory/enrichment-gate.js",
      "../memory/graph-export.js",
    ];

    for (const filePath of testFiles) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const bad of banned) {
        assert.ok(!source.includes(bad), `${filePath} should not import ${bad}`);
      }
    }
  });

  it("includes artifact intake dispatch contract", () => {
    const orchestrator = fs.readFileSync(".opencode/agents/brand-builder.md", "utf8");
    assert.ok(orchestrator.includes("<artifact_intake_update>"));
    assert.ok(orchestrator.includes("bb-knowledge-steward"));
  });

  it("phase 3 summaries declare exact requirements-completed coverage", () => {
    const checks = [
      [
        ".planning/phases/03-current-state-assessment/03-01-SUMMARY.md",
        "requirements-completed: [ASSESS-01, ASSESS-02]",
      ],
      [
        ".planning/phases/03-current-state-assessment/03-02-SUMMARY.md",
        "requirements-completed: [ASSESS-01, ASSESS-02, ASSESS-03]",
      ],
      [
        ".planning/phases/03-current-state-assessment/03-03-SUMMARY.md",
        "requirements-completed: [ASSESS-01, ASSESS-04]",
      ],
    ];

    for (const [filePath, requiredLine] of checks) {
      const source = fs.readFileSync(filePath, "utf8");
      assert.ok(source.includes(requiredLine), `${filePath} should contain ${requiredLine}`);
    }
  });
});
