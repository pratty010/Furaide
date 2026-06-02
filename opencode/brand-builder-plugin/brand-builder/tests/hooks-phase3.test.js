"use strict";

/**
 * Phase 3 Hook Predicates Tests
 *
 * Tests ONLY the pure functions in hook-predicates.js.
 * No opencode runtime, no DB, no side effects.
 */

const { describe, test, expect } = require("bun:test");
const {
  checkRouting,
  checkHardPrereqs,
  checkSoftPrereqs,
  checkApproval,
  isProtectedPath,
  INTENT_ROUTING,
  HARD_PREREQS,
  SOFT_PREREQS,
} = require("../hooks/hook-predicates.js");

// ---------------------------------------------------------------------------
// isProtectedPath
// ---------------------------------------------------------------------------

describe("isProtectedPath", () => {
  test("returns true for /data/artifacts/ path (unix forward slash)", () => {
    expect(isProtectedPath("/some/root/data/artifacts/resume.txt")).toBe(true);
  });

  test("returns true for \\data\\artifacts\\ path (windows backslash)", () => {
    expect(isProtectedPath("C:\\Users\\foo\\data\\artifacts\\resume.txt")).toBe(true);
  });

  test("returns false for unrelated path", () => {
    expect(isProtectedPath("/home/user/documents/notes.txt")).toBe(false);
  });

  test("returns false for path that almost matches", () => {
    expect(isProtectedPath("/data/other/resume.txt")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isProtectedPath(null)).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isProtectedPath("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkRouting
// ---------------------------------------------------------------------------

describe("checkRouting", () => {
  test("returns null when activeIntent is null (no constraint)", () => {
    expect(checkRouting(null, "bb_linkedin")).toBeNull();
  });

  test("returns null when activeIntent is undefined", () => {
    expect(checkRouting(undefined, "bb_linkedin")).toBeNull();
  });

  test("returns null for non-bb_ tools (routing does not apply)", () => {
    expect(checkRouting("linkedin_optimization", "read")).toBeNull();
    expect(checkRouting("linkedin_optimization", "write")).toBeNull();
  });

  test("returns null when tool is in allowed set for the intent", () => {
    expect(checkRouting("linkedin_optimization", "bb_linkedin")).toBeNull();
    expect(checkRouting("linkedin_optimization", "bb_ats_scan")).toBeNull();
    expect(checkRouting("role_fit_assessment", "bb_role_fit")).toBeNull();
    expect(checkRouting("role_fit_assessment", "bb_parse_jd")).toBeNull();
  });

  test("returns error when tool is NOT in allowed set for the intent", () => {
    const result = checkRouting("linkedin_optimization", "bb_brand");
    expect(result).not.toBeNull();
    expect(result).toContain("bb_brand");
    expect(result).toContain("linkedin_optimization");
  });

  test("returns error: bb_github_proof blocked under linkedin_optimization", () => {
    const result = checkRouting("linkedin_optimization", "bb_github_proof");
    expect(result).not.toBeNull();
    expect(result).toContain("bb_github_proof");
  });

  test("returns null for utility tools regardless of intent (bb_complete_run)", () => {
    expect(checkRouting("linkedin_optimization", "bb_complete_run")).toBeNull();
    expect(checkRouting("brand_strategy", "bb_record_review")).toBeNull();
  });

  test("returns null for utility tools regardless of intent (bb_get_context, bb_profile_state)", () => {
    expect(checkRouting("progress_feedback", "bb_get_context")).toBeNull();
    expect(checkRouting("progress_feedback", "bb_profile_state")).toBeNull();
  });

  test("returns null for unknown intent (fail open)", () => {
    expect(checkRouting("unknown_intent_xyz", "bb_linkedin")).toBeNull();
  });

  test("progress_feedback only allows bb_progress", () => {
    const allowed = checkRouting("progress_feedback", "bb_progress");
    expect(allowed).toBeNull();
    const blocked = checkRouting("progress_feedback", "bb_linkedin");
    expect(blocked).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkHardPrereqs
// ---------------------------------------------------------------------------

describe("checkHardPrereqs", () => {
  // bb_role_fit requires bb_parse_jd ran this session
  describe("bb_role_fit", () => {
    test("returns error when bb_parse_jd has NOT run", () => {
      const result = checkHardPrereqs("bb_role_fit", new Set(), {}, 0);
      expect(result).not.toBeNull();
      expect(result).toContain("bb_parse_jd");
    });

    test("returns null when bb_parse_jd HAS run", () => {
      const result = checkHardPrereqs("bb_role_fit", new Set(["bb_parse_jd"]), {}, 0);
      expect(result).toBeNull();
    });

    test("returns error when enginesRun has other tools but not bb_parse_jd", () => {
      const result = checkHardPrereqs("bb_role_fit", new Set(["bb_assess", "bb_linkedin"]), {}, 5);
      expect(result).not.toBeNull();
    });
  });

  // bb_progress requires at least 2 snapshots
  describe("bb_progress", () => {
    test("returns error when snapshotCount is 0", () => {
      const result = checkHardPrereqs("bb_progress", new Set(), {}, 0);
      expect(result).not.toBeNull();
      expect(result).toContain("snapshots");
    });

    test("returns error when snapshotCount is 1", () => {
      const result = checkHardPrereqs("bb_progress", new Set(), {}, 1);
      expect(result).not.toBeNull();
    });

    test("returns null when snapshotCount is exactly 2", () => {
      const result = checkHardPrereqs("bb_progress", new Set(), {}, 2);
      expect(result).toBeNull();
    });

    test("returns null when snapshotCount is greater than 2", () => {
      const result = checkHardPrereqs("bb_progress", new Set(), {}, 10);
      expect(result).toBeNull();
    });
  });

  // bb_github_proof requires explicit selectedRepos
  describe("bb_github_proof", () => {
    test("returns error when selectedRepos arg is missing", () => {
      const result = checkHardPrereqs("bb_github_proof", new Set(), {}, 0);
      expect(result).not.toBeNull();
      expect(result).toContain("selectedRepos");
    });

    test("returns error when selectedRepos is empty array", () => {
      const result = checkHardPrereqs("bb_github_proof", new Set(), { selectedRepos: [] }, 0);
      expect(result).not.toBeNull();
    });

    test("returns error when selectedRepos is null", () => {
      const result = checkHardPrereqs("bb_github_proof", new Set(), { selectedRepos: null }, 0);
      expect(result).not.toBeNull();
    });

    test("returns null when selectedRepos is a non-empty array", () => {
      const result = checkHardPrereqs("bb_github_proof", new Set(), { selectedRepos: ["my-repo"] }, 0);
      expect(result).toBeNull();
    });
  });

  // Tools with no hard prereqs
  describe("tools with no hard prereqs", () => {
    test("returns null for bb_assess (no prereqs defined)", () => {
      expect(checkHardPrereqs("bb_assess", new Set(), {}, 0)).toBeNull();
    });

    test("returns null for bb_linkedin (no prereqs defined)", () => {
      expect(checkHardPrereqs("bb_linkedin", new Set(), {}, 0)).toBeNull();
    });

    test("returns null for bb_brand (no hard prereqs)", () => {
      expect(checkHardPrereqs("bb_brand", new Set(), {}, 0)).toBeNull();
    });

    test("returns null for unknown tool", () => {
      expect(checkHardPrereqs("bb_unknown_tool", new Set(), {}, 0)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// checkSoftPrereqs
// ---------------------------------------------------------------------------

describe("checkSoftPrereqs", () => {
  describe("bb_brand", () => {
    test("returns warning when bb_assess has NOT run", () => {
      const result = checkSoftPrereqs("bb_brand", new Set());
      expect(result).not.toBeNull();
      expect(result).toContain("assessment");
    });

    test("returns null when bb_assess HAS run", () => {
      const result = checkSoftPrereqs("bb_brand", new Set(["bb_assess"]));
      expect(result).toBeNull();
    });
  });

  describe("bb_growth", () => {
    test("returns warning when bb_assess has NOT run", () => {
      const result = checkSoftPrereqs("bb_growth", new Set());
      expect(result).not.toBeNull();
      expect(result).toContain("assessment");
    });

    test("returns null when bb_assess HAS run", () => {
      const result = checkSoftPrereqs("bb_growth", new Set(["bb_assess"]));
      expect(result).toBeNull();
    });

    test("returns null when both bb_assess and other engines have run", () => {
      const result = checkSoftPrereqs("bb_growth", new Set(["bb_parse_jd", "bb_assess", "bb_role_fit"]));
      expect(result).toBeNull();
    });
  });

  describe("tools with no soft prereqs", () => {
    test("returns null for bb_assess", () => {
      expect(checkSoftPrereqs("bb_assess", new Set())).toBeNull();
    });

    test("returns null for bb_linkedin", () => {
      expect(checkSoftPrereqs("bb_linkedin", new Set())).toBeNull();
    });

    test("returns null for bb_role_fit", () => {
      expect(checkSoftPrereqs("bb_role_fit", new Set())).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// checkApproval
// ---------------------------------------------------------------------------

describe("checkApproval", () => {
  const filePath = "/data/artifacts/resume.txt";
  const digest = "abc123def456";

  test("returns error when approvals array is empty", () => {
    const result = checkApproval([], filePath, digest);
    expect(result).not.toBeNull();
    expect(result).toContain(filePath);
  });

  test("returns error when approvals is null", () => {
    const result = checkApproval(null, filePath, digest);
    expect(result).not.toBeNull();
  });

  test("returns null for a valid unconsumed (non-stale) token matching the digest", () => {
    const approvals = [{ stale: false, reason_given: `Change digest: ${digest}` }];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).toBeNull();
  });

  test("returns error when all tokens are stale", () => {
    const approvals = [{ stale: true, reason_given: `Change digest: ${digest}` }];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).not.toBeNull();
    expect(result).toContain("stale");
  });

  test("returns error when token exists but digest does not match", () => {
    const approvals = [{ stale: false, reason_given: "Change digest: differentdigest" }];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).not.toBeNull();
  });

  test("returns null when one token matches even if others are stale", () => {
    const approvals = [
      { stale: true, reason_given: `Change digest: ${digest}` },  // stale — skip
      { stale: false, reason_given: `Change digest: ${digest}` }, // valid
    ];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).toBeNull();
  });

  test("returns error when all tokens are for a different digest", () => {
    const approvals = [
      { stale: false, reason_given: "Change digest: aaaa1111" },
      { stale: false, reason_given: "Change digest: bbbb2222" },
    ];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).not.toBeNull();
  });

  test("returns error when stale=1 (truthy number, SQLite-style)", () => {
    // SQLite returns 1/0 for booleans
    const approvals = [{ stale: 1, reason_given: `Change digest: ${digest}` }];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).not.toBeNull();
  });

  test("returns null when stale=0 (falsy number, SQLite-style) and digest matches", () => {
    const approvals = [{ stale: 0, reason_given: `Change digest: ${digest}` }];
    const result = checkApproval(approvals, filePath, digest);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// INTENT_ROUTING completeness sanity checks
// ---------------------------------------------------------------------------

describe("INTENT_ROUTING constant sanity", () => {
  test("has 8 intent keys", () => {
    expect(Object.keys(INTENT_ROUTING)).toHaveLength(8);
  });

  test("each intent has at least one allowed tool", () => {
    for (const [intent, tools] of Object.entries(INTENT_ROUTING)) {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  test("all allowed tools start with bb_", () => {
    for (const tools of Object.values(INTENT_ROUTING)) {
      for (const t of tools) {
        expect(t.startsWith("bb_")).toBe(true);
      }
    }
  });
});
