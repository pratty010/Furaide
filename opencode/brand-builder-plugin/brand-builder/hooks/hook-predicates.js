"use strict";

/**
 * Brand Builder Hook Predicates
 *
 * Pure functions only — no DB, no side effects.
 * Safe to unit-test without opencode runtime.
 *
 * Used by the plugin hooks (tool.execute.before / after) to enforce:
 *   1. Routing guard  — is this tool allowed for the active intent?
 *   2. Hard prereqs   — required prior steps (block if missing)
 *   3. Soft prereqs   — beneficial prior steps (warn if missing)
 *   4. Approval gate  — protected artifact paths need an unconsumed token
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps workflow intent names to the set of specialist tool names that are
 * allowed within that intent.  Tools not in this list are blocked when an
 * intent is active.
 *
 * Note: read-only / utility tools (bb_get_context, bb_profile_state, etc.)
 * are intentionally omitted — they should be freely callable from any intent.
 * The routing guard only fires for specialist/engine tools.
 */
const INTENT_ROUTING = {
  artifact_intake_update:   ["bb_intake", "bb_promote", "bb_embed", "bb_approve"],
  current_state_assessment: ["bb_assess", "bb_snapshot"],
  role_fit_assessment:      ["bb_assess", "bb_role_fit", "bb_parse_jd", "bb_snapshot"],
  linkedin_optimization:    ["bb_linkedin", "bb_ats_scan", "bb_record_review"],
  github_proof_building:    ["bb_github_proof", "bb_record_review"],
  brand_strategy:           ["bb_brand", "bb_record_review"],
  growth_planning:          ["bb_growth", "bb_record_review"],
  progress_feedback:        ["bb_progress"],
};

/**
 * Hard prerequisites per engine tool.
 * Missing these → throw (block the call).
 *
 * Shape variants:
 *   { requires: string[] }          — prior tool must have run this session
 *   { requiresMinSnapshots: number } — DB must have at least N snapshots
 *   { requiresArg: string }         — named arg must be present and non-empty
 *
 * A tool entry may combine requiresArg with requires/requiresMinSnapshots.
 */
const HARD_PREREQS = {
  bb_role_fit: {
    requires: ["bb_parse_jd"],
    message: "bb_parse_jd must run before bb_role_fit",
  },
  bb_progress: {
    requiresMinSnapshots: 2,
    message: "bb_progress requires at least 2 snapshots",
  },
  bb_github_proof: {
    requiresArg: "selectedRepos",
    message: "bb_github_proof requires explicit selectedRepos — never auto-select",
  },
};

/**
 * Soft prerequisites per engine tool.
 * Missing these → warn (console.warn) but do NOT block.
 */
const SOFT_PREREQS = {
  bb_brand:  { benefits: ["bb_assess"], message: "bb_brand works better with a current assessment" },
  bb_growth: { benefits: ["bb_assess"], message: "bb_growth works better with a current assessment" },
};

/**
 * File path prefixes that require an unconsumed approval token before any
 * write/edit tool is permitted to mutate them.
 */
const PROTECTED_PATH_PREFIXES = ["/data/artifacts/", "\\data\\artifacts\\"];

// ---------------------------------------------------------------------------
// isProtectedPath
// ---------------------------------------------------------------------------

/**
 * Returns true if the given file path is under a protected artifacts prefix.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isProtectedPath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  const normalized = filePath.replace(/\\/g, "/");
  return PROTECTED_PATH_PREFIXES.some(prefix =>
    normalized.includes(prefix.replace(/\\/g, "/"))
  );
}

// ---------------------------------------------------------------------------
// checkRouting
// ---------------------------------------------------------------------------

/**
 * Returns null when the tool is allowed for the active intent,
 * or an error message string when it is blocked.
 *
 * Read-only / utility tools are never blocked (they start with bb_ but are
 * listed in ALLOWED_UTILITY_TOOLS).  Non-bb_ tools are always allowed —
 * routing only constrains Brand Builder specialist tools.
 *
 * @param {string|null} activeIntent
 * @param {string} toolName
 * @returns {string|null}
 */
const ALLOWED_UTILITY_TOOLS = new Set([
  "bb_get_context",
  "bb_profile_state",
  "bb_snapshots",
  "bb_staleness",
  "bb_evidence_search",
  "bb_complete_run",
  "bb_record_review",
  "bb_approve",
  "bb_snapshot",
  "bb_reembed",
]);

function checkRouting(activeIntent, toolName) {
  // No active intent → no routing constraint
  if (!activeIntent) return null;
  // Non-bb_ tools are not under Brand Builder routing
  if (!toolName.startsWith("bb_")) return null;
  // Utility / admin tools always pass
  if (ALLOWED_UTILITY_TOOLS.has(toolName)) return null;

  const allowedTools = INTENT_ROUTING[activeIntent];
  if (!allowedTools) {
    // Unknown intent — allow everything (fail open for unknown intents)
    return null;
  }

  if (!allowedTools.includes(toolName)) {
    return `Tool "${toolName}" is not allowed for intent "${activeIntent}". Allowed tools: ${allowedTools.join(", ")}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// checkHardPrereqs
// ---------------------------------------------------------------------------

/**
 * Returns null when all hard prerequisites are satisfied,
 * or an error message string when a prerequisite is missing.
 *
 * @param {string} toolName
 * @param {Set<string>} enginesRun  — tool names that ran this session
 * @param {Record<string, unknown>} args  — call arguments
 * @param {number} snapshotCount  — total snapshots in DB
 * @returns {string|null}
 */
function checkHardPrereqs(toolName, enginesRun, args, snapshotCount) {
  const prereq = HARD_PREREQS[toolName];
  if (!prereq) return null;

  // requires: prior tool(s) must have run this session
  if (prereq.requires) {
    for (const required of prereq.requires) {
      if (!enginesRun.has(required)) {
        return prereq.message || `${required} must run before ${toolName}`;
      }
    }
  }

  // requiresMinSnapshots: DB must have at least N snapshots
  if (prereq.requiresMinSnapshots !== undefined) {
    const count = typeof snapshotCount === "number" ? snapshotCount : 0;
    if (count < prereq.requiresMinSnapshots) {
      return prereq.message || `${toolName} requires at least ${prereq.requiresMinSnapshots} snapshots (found ${count})`;
    }
  }

  // requiresArg: named arg must be present, non-null, and non-empty
  if (prereq.requiresArg) {
    const val = args && args[prereq.requiresArg];
    const missing =
      val === undefined ||
      val === null ||
      (Array.isArray(val) && val.length === 0) ||
      val === "";
    if (missing) {
      return prereq.message || `${toolName} requires argument "${prereq.requiresArg}"`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// checkSoftPrereqs
// ---------------------------------------------------------------------------

/**
 * Returns null when all beneficial prerequisites are present (no warning
 * needed), or a warning message string when they are absent.
 * This function never blocks — callers should console.warn on non-null.
 *
 * @param {string} toolName
 * @param {Set<string>} enginesRun
 * @returns {string|null}
 */
function checkSoftPrereqs(toolName, enginesRun) {
  const prereq = SOFT_PREREQS[toolName];
  if (!prereq) return null;

  for (const beneficial of prereq.benefits) {
    if (!enginesRun.has(beneficial)) {
      return prereq.message || `${toolName} works better if ${beneficial} has run first`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// checkApproval
// ---------------------------------------------------------------------------

/**
 * Returns null when a valid, unconsumed approval token exists for the given
 * path + digest combination.  Returns an error message string otherwise.
 *
 * @param {Array<{stale?: boolean, consumed_at?: string, reason_given?: string}>} approvals  — rows from enrichment_approvals
 * @param {string} filePath
 * @param {string} changeDigest
 * @returns {string|null}
 */
function checkApproval(approvals, filePath, changeDigest) {
  if (!approvals || approvals.length === 0) {
    return `Write to protected path "${filePath}" requires an approval token. Run bb_approve first.`;
  }

  // Look for a non-stale, unconsumed approval whose reason_given includes the changeDigest
  const valid = approvals.find((a) => {
    if (a.stale) return false;
    if (a.consumed_at) return false;  // single-use: consumed tokens are invalid
    // reason_given format from bb_approve: "Change digest: {digest}"
    const rg = a.reason_given || "";
    return rg.includes(changeDigest);
  });

  if (!valid) {
    return `No valid approval token found for path "${filePath}" with digest "${changeDigest}". The token may be stale, already consumed, or for a different change.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  INTENT_ROUTING,
  HARD_PREREQS,
  SOFT_PREREQS,
  PROTECTED_PATH_PREFIXES,
  ALLOWED_UTILITY_TOOLS,
  isProtectedPath,
  checkRouting,
  checkHardPrereqs,
  checkSoftPrereqs,
  checkApproval,
};
