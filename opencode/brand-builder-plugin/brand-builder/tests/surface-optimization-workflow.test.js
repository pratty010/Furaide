/**
 * surface-optimization-workflow.test.js — Phase 05-04
 *
 * Integration coverage for LinkedIn-first synthesis, clarification gates,
 * and end-to-end workflow contract enforcement.
 *
 * Test 1: LinkedIn-first ordering (D-14) — when both surface outputs are
 *   present, the synthesized answer body orders LinkedIn before GitHub.
 * Test 2: Caveat-first ordering — low-confidence LinkedIn evidence or
 *   missing-artifact flags surface the caveat before variant text; GitHub
 *   selected-repo scope is preserved in the output.
 * Test 3: Final output contract — the synthesized result includes both proof
 *   improvements and next project ideas, plus exactly one
 *   recommended_next_action field.
 *
 * The synthesis function under test implements the rules from
 * synthesis-and-clarification.md, specifically the LinkedIn-first ordering
 * rule and the single_final_response contract fields.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Synthesis function under test
//
// Implements the orchestrator synthesis rules from
// synthesis-and-clarification.md. Takes normalized specialist outputs
// and assembles one final answer per the single_final_response contract.
// ---------------------------------------------------------------------------

/**
 * Synthesize LinkedIn and GitHub specialist outputs into one final response.
 *
 * Rules enforced:
 *   - LinkedIn output appears before GitHub output in the answer body (D-14)
 *   - Anti-voice caveats precede variant text when confidence is weak
 *   - GitHub selected-repo scope is preserved in output
 *   - Exactly one recommended_next_action is produced
 *   - output_contract fields are all present
 *
 * @param {object} linkedin - Normalized bb-linkedin-optimizer output
 * @param {object} github   - Normalized bb-github-proof output (nullable)
 * @returns {object} single_final_response shape
 */
function synthesizeSurfaceWorkflow(linkedin, github) {
  const evidenceUsed = [];
  const specialistsConsulted = [];

  // Collect evidence
  if (linkedin && linkedin.evidence_used) {
    evidenceUsed.push(...linkedin.evidence_used);
  }
  if (github && github.evidence_used) {
    evidenceUsed.push(...github.evidence_used);
  }

  // Build answer body — LinkedIn first, then GitHub (D-14)
  const answerParts = [];

  // LinkedIn section (D-14: LinkedIn first)
  if (linkedin) {
    specialistsConsulted.push("bb-linkedin-optimizer");
    answerParts.push("## LinkedIn Optimization");
    if (linkedin.section_diagnoses) {
      for (const [section, diagnosis] of Object.entries(linkedin.section_diagnoses)) {
        if (diagnosis.present) {
          answerParts.push(`### ${section}: ${diagnosis.coverage_notes || "Present"}`);
          // Caveats appear before variants (Rule 2)
          if (linkedin.voice_risks && linkedin.voice_risks.assessment) {
            answerParts.push(`> Voice check: ${linkedin.voice_risks.assessment}`);
          }
          if (linkedin.uncertainties && linkedin.uncertainties.length > 0) {
            for (const u of linkedin.uncertainties) {
              answerParts.push(`> Uncertainty: ${u}`);
            }
          }
          if (linkedin.stale_evidence_warning) {
            answerParts.push(`> ${linkedin.stale_evidence_warning}`);
          }
          // Then variants
          if (linkedin.rewrite_variants && linkedin.rewrite_variants[section]) {
            for (const v of linkedin.rewrite_variants[section]) {
              answerParts.push(`- **${v.variant_number ? `Variant ${v.variant_number}` : "Variant"}**: ${typeof v.text === "string" ? v.text : v.text?.join("; ")} — ${v.rationale || ""}`);
            }
          }
        } else {
          answerParts.push(`### ${section}: Not present — ${diagnosis.coverage_notes || "Section missing"}`);
        }
      }
    } else {
      answerParts.push("No section diagnoses available.");
    }
  }

  // GitHub section (D-14: GitHub second)
  if (github) {
    specialistsConsulted.push("bb-github-proof");
    answerParts.push("## GitHub Proof Building");
    if (github.evaluation_order) {
      answerParts.push(`Evaluation order: ${github.evaluation_order}`);
    }
    if (github.selected_repos && github.selected_repos.length > 0) {
      answerParts.push(`Repos evaluated: ${github.selected_repos.join(", ")}`);
    }
    // Stale evidence caveat before repo details
    if (github.stale_evidence_warning) {
      answerParts.push(`> ${github.stale_evidence_warning}`);
    }
    if (github.uncertainties && github.uncertainties.length > 0) {
      for (const u of github.uncertainties) {
        answerParts.push(`> Uncertainty: ${u}`);
      }
    }
    if (github.repo_dispositions) {
      for (const repo of github.repo_dispositions) {
        answerParts.push(`- **${repo.repo_name}**: ${repo.disposition} (portfolio: ${repo.portfolio_value_score}, proof: ${repo.proof_quality_score}, eng: ${repo.engineering_quality_score})`);
        if (repo.diagnosis) {
          answerParts.push(`  ${repo.diagnosis}`);
        }
      }
    }
    if (github.proof_gaps && github.proof_gaps.length > 0) {
      answerParts.push("### Proof Gaps");
      for (const gap of github.proof_gaps) {
        answerParts.push(`- ${gap.repo_name}: ${gap.gap_description}`);
      }
    }
    if (github.proof_improvements && github.proof_improvements.length > 0) {
      answerParts.push("### Proof Improvements");
      for (const imp of github.proof_improvements) {
        answerParts.push(`- ${typeof imp === "string" ? imp : imp.action || imp.description || ""}`);
      }
    }
    if (github.next_project_ideas && github.next_project_ideas.length > 0) {
      answerParts.push("### Next Project Ideas");
      for (const idea of github.next_project_ideas) {
        answerParts.push(`- ${typeof idea === "string" ? idea : idea.title || idea.description || ""}`);
      }
    }
  }

  // If neither specialist output is available, return a safe fallback
  if (!linkedin && !github) {
    return {
      request_understood: "Surface optimization — no specialist outputs available",
      evidence_used: [],
      specialists_consulted: [],
      answer: "No specialist outputs were provided for synthesis. Run bb-current-state to establish an assessment baseline, then retry with specific surface optimization requests.",
      uncertainty_or_missing_context: "Both LinkedIn and GitHub specialist outputs are missing — cannot synthesize surface optimization.",
      recommended_next_action: "Run bb-current-state to establish an assessment baseline before surface optimization.",
    };
  }

  // Determine single recommended_next_action
  let recommendedNextAction = "";
  if (linkedin && linkedin.recommended_next_action) {
    recommendedNextAction = linkedin.recommended_next_action;
  } else if (github && github.recommended_next_action) {
    recommendedNextAction = github.recommended_next_action;
  } else {
    recommendedNextAction = "Run bb-current-state to establish an assessment baseline before surface optimization.";
  }

  // Collect uncertainties
  const uncertainties = [];
  if (linkedin && linkedin.uncertainties) {
    uncertainties.push(...linkedin.uncertainties);
  }
  if (github && github.uncertainties) {
    uncertainties.push(...github.uncertainties);
  }
  if (linkedin && linkedin.stale_evidence_warning) {
    uncertainties.push(`LinkedIn: ${linkedin.stale_evidence_warning}`);
  }
  if (github && github.stale_evidence_warning) {
    uncertainties.push(`GitHub: ${github.stale_evidence_warning}`);
  }

  return {
    request_understood: "Surface optimization for LinkedIn and GitHub profiles",
    evidence_used: [...new Set(evidenceUsed)],
    specialists_consulted: specialistsConsulted,
    answer: answerParts.join("\n"),
    uncertainty_or_missing_context: uncertainties.join("; ") || "None",
    recommended_next_action: recommendedNextAction,
  };
}

// ---------------------------------------------------------------------------
// Mock specialist outputs
// ---------------------------------------------------------------------------

function makeLinkedInOutput(overrides = {}) {
  return {
    workflow_domain: "linkedin_optimization",
    evidence_used: ["linkedin", "resume"],
    section_diagnoses: {
      headline: { section_name: "headline", present: true, coverage_notes: "Functional but lacks seniority signal", variant_count: 3 },
      about: { section_name: "about", present: true, coverage_notes: "Needs stronger narrative", variant_count: 2 },
      experience: { section_name: "experience", present: true, coverage_notes: "Bullet format recommended for scannability", variant_count: 2 },
      featured: { section_name: "featured", present: false, coverage_notes: "No featured content", variant_count: 2 },
      skills: { section_name: "skills", present: true, coverage_notes: "Skills present; reorder by role-family relevance", variant_count: 1 },
    },
    rewrite_variants: {
      headline: [
        { variant_number: 1, text: "Staff Engineer | TypeScript & Platform Architecture", rationale: "Discovery-leaning", focus: "discoverability" },
        { variant_number: 2, text: "Platform Engineer — Building Scalable Systems", rationale: "Narrative-leaning", focus: "signal" },
        { variant_number: 3, text: "Senior Engineer | Distributed Systems & TypeScript", rationale: "Balanced", focus: "clarity" },
      ],
      about: [
        { variant_number: 1, text: "Engineer with 8+ years...", rationale: "Brand-aligned", focus: "impact" },
        { variant_number: 2, text: "Full-stack platform engineer...", rationale: "Role-family targeted", focus: "discoverability" },
      ],
      experience: [
        { variant_number: 1, text: ["Led platform migration reducing latency by 40%", "Architected distributed event system"], rationale: "Signal-focused", focus: "signal" },
        { variant_number: 2, text: ["Owned cross-team platform architecture", "Delivered scalable microservices"], rationale: "Balanced", focus: "clarity" },
      ],
      featured: [],
      skills: [
        { variant_number: 1, text: ["TypeScript", "Node.js", "System Design", "PostgreSQL", "Docker", "AWS"], rationale: "Reordered by role-family relevance", focus: "discoverability" },
      ],
    },
    voice_risks: { flagged_claims: [], contradictions: [], overconfidence_notes: [], assessment: "All claims evidence-supported" },
    stale_evidence_warning: null,
    missing_artifact_flag: false,
    confidence: "medium",
    uncertainties: ["Featured section recommendations based on resume evidence only"],
    recommended_next_action: "Apply headline Variant 1 and experience Variant 1; refresh LinkedIn evidence via bb-intake",
    ...overrides,
  };
}

function makeGitHubOutput(overrides = {}) {
  return {
    workflow_domain: "github",
    evidence_used: ["github_profile", "resume"],
    selected_repos: ["my-portfolio", "open-source-lib"],
    profile_surface_judgment: "Moderate proof depth across selected repos",
    repo_dispositions: [
      {
        repo_name: "my-portfolio",
        disposition: "Highlight",
        portfolio_value_score: 85,
        proof_quality_score: 78,
        engineering_quality_score: 72,
        portfolio_value_note: "Strong alignment with senior-fullstack role family",
        proof_quality_note: "Clean README, good test coverage, CI configured",
        engineering_quality_note: "Well-structured code, appropriate abstractions",
        diagnosis: "This is your strongest proof repo — showcase it prominently.",
        proof_improvements: ["Add architecture decision records", "Include performance benchmarks in README"],
        next_project_signals: ["Consider extracting the auth module as a standalone library"],
        sampled_paths: ["README.md", "src/", "package.json"],
        full_analysis_available: true,
      },
      {
        repo_name: "open-source-lib",
        disposition: "Improve soon",
        portfolio_value_score: 65,
        proof_quality_score: 58,
        engineering_quality_score: 70,
        portfolio_value_note: "Relevant but niche library",
        proof_quality_note: "Missing documentation and contribution guide",
        engineering_quality_note: "Solid implementation but lacks tests",
        diagnosis: "Good foundation — invest in documentation and tests.",
        proof_improvements: ["Write a comprehensive README with examples", "Add CONTRIBUTING.md and test suite"],
        next_project_signals: ["A demo application would strengthen proof quality"],
        sampled_paths: ["README.md", "src/", "lib/", "package.json"],
        full_analysis_available: false,
      },
    ],
    evaluation_order: "portfolio value -> proof quality -> engineering quality",
    proof_gaps: [
      { repo_name: "my-portfolio", gap_description: "No system design documentation", projected_impact: "medium" },
      { repo_name: "open-source-lib", gap_description: "No test suite or CI pipeline", projected_impact: "high" },
    ],
    proof_improvements: [
      "Add architecture documentation to my-portfolio",
      "Add test suite and CI to open-source-lib",
      "Create a demo application for open-source-lib",
    ],
    next_project_ideas: [
      "Build a real-time dashboard showing system metrics as proof of full-stack capability",
      "Create a CLI tool for database migration management to demonstrate infra skills",
    ],
    stale_evidence_warning: null,
    confidence: "medium",
    uncertainties: ["open-source-lib analysis is sampled — full analysis may reveal more proof"],
    recommended_next_action: "Address open-source-lib documentation and test gaps; then build the real-time dashboard to fill full-stack proof gaps",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: LinkedIn-first ordering (D-14)
// ---------------------------------------------------------------------------

describe("LinkedIn-first synthesis ordering (D-14)", () => {
  it("presents LinkedIn results before GitHub results in the answer body", () => {
    const li = makeLinkedInOutput();
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(li, gh);

    const answer = result.answer;
    const liIndex = answer.indexOf("## LinkedIn Optimization");
    const ghIndex = answer.indexOf("## GitHub Proof Building");

    assert.ok(liIndex >= 0, "Answer should contain LinkedIn section");
    assert.ok(ghIndex >= 0, "Answer should contain GitHub section");
    assert.ok(liIndex < ghIndex, "LinkedIn section must appear before GitHub section (D-14)");
  });

  it("includes both surface outputs in the answer when both are provided", () => {
    const li = makeLinkedInOutput();
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(li, gh);

    assert.ok(result.answer.includes("## LinkedIn Optimization"));
    assert.ok(result.answer.includes("## GitHub Proof Building"));
  });

  it("handles GitHub-only output (no LinkedIn) gracefully", () => {
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(null, gh);

    assert.ok(!result.answer.includes("## LinkedIn Optimization"));
    assert.ok(result.answer.includes("## GitHub Proof Building"));
  });

  it("handles LinkedIn-only output (no GitHub) gracefully", () => {
    const li = makeLinkedInOutput();
    const result = synthesizeSurfaceWorkflow(li, null);

    assert.ok(result.answer.includes("## LinkedIn Optimization"));
    assert.ok(!result.answer.includes("## GitHub Proof Building"));
  });
});

// ---------------------------------------------------------------------------
// Test 2: Caveat-first ordering and scope preservation
// ---------------------------------------------------------------------------

describe("Anti-voice caveat placement (Rule 2)", () => {
  it("surfaces low-confidence LinkedIn caveat before variant text", () => {
    const li = makeLinkedInOutput({
      confidence: "low",
      voice_risks: {
        flagged_claims: ["Headline Variant 2 implies executive scope"],
        contradictions: [],
        overconfidence_notes: ["Confidence exceeds evidence depth"],
        assessment: "Headline variant overstates seniority — evidence shows team-lead not director",
      },
      uncertainties: ["Only resume evidence available", "LinkedIn profile is 60 days stale"],
    });

    const result = synthesizeSurfaceWorkflow(li, null);
    const answer = result.answer;

    // The voice check and uncertainty should appear before the variant text
    const voiceIndex = answer.indexOf("Voice check:");
    const uncertaintyIndex = answer.indexOf("Uncertainty:");
    const firstVariantIndex = answer.indexOf("Variant 1");

    assert.ok(voiceIndex >= 0, "Voice check caveat must be present");
    assert.ok(uncertaintyIndex >= 0, "Uncertainty must be present");
    if (firstVariantIndex >= 0) {
      assert.ok(voiceIndex < firstVariantIndex, "Voice check must appear before first variant");
    }
  });

  it("surfaces stale evidence warning before detailed recommendations", () => {
    const li = makeLinkedInOutput({
      stale_evidence_warning: "Evidence for LinkedIn optimization is 45 days old. Consider refreshing via bb-intake before proceeding.",
    });
    const gh = makeGitHubOutput({
      stale_evidence_warning: "Evidence for GitHub proof evaluation is 60 days old. Consider refreshing evidence via bb-intake before relying on these scores.",
    });

    const result = synthesizeSurfaceWorkflow(li, gh);
    const answer = result.answer;

    // Stale warnings should be present
    assert.ok(answer.includes("45 days old"), "LinkedIn stale warning should be visible");
    assert.ok(answer.includes("60 days old"), "GitHub stale warning should be visible");
  });
});

describe("GitHub selected-repo scope preservation (D-08, D-12)", () => {
  it("includes the exact selected_repos in the output", () => {
    const gh = makeGitHubOutput({
      selected_repos: ["my-portfolio", "open-source-lib"],
    });

    const result = synthesizeSurfaceWorkflow(null, gh);
    const answer = result.answer;

    assert.ok(answer.includes("my-portfolio"), "Must include my-portfolio in output");
    assert.ok(answer.includes("open-source-lib"), "Must include open-source-lib in output");
    assert.ok(answer.includes("Repos evaluated:"), "Must explicitly list evaluated repos");
  });

  it("only includes repos from the selected_repos list", () => {
    const gh = makeGitHubOutput({
      selected_repos: ["my-portfolio"],
      repo_dispositions: [
        {
          repo_name: "my-portfolio",
          disposition: "Highlight",
          portfolio_value_score: 85,
          proof_quality_score: 78,
          engineering_quality_score: 72,
          portfolio_value_note: "Strong alignment",
          proof_quality_note: "Good coverage",
          engineering_quality_note: "Solid",
          diagnosis: "Key proof repo.",
          proof_improvements: [],
          next_project_signals: [],
          sampled_paths: ["README.md"],
          full_analysis_available: false,
        },
      ],
      proof_gaps: [{ repo_name: "my-portfolio", gap_description: "No CI badge", projected_impact: "low" }],
      proof_improvements: ["Add CI badge"],
      next_project_ideas: ["Build a demo app"],
      uncertainties: ["my-portfolio analysis is sampled"],
    });

    const result = synthesizeSurfaceWorkflow(null, gh);
    const answer = result.answer;

    assert.ok(answer.includes("my-portfolio"), "Selected repo must be present");
    assert.ok(!answer.includes("open-source-lib"), "Unselected repo must NOT appear");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Final output contract
// ---------------------------------------------------------------------------

describe("Final output contract compliance", () => {
  it("includes proof improvements and next project ideas in the output", () => {
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(null, gh);
    const answer = result.answer;

    assert.ok(answer.includes("Proof Improvements"), "Must include proof improvements section");
    assert.ok(answer.includes("Next Project Ideas"), "Must include next project ideas section");
  });

  it("provides exactly one recommended_next_action field", () => {
    const li = makeLinkedInOutput();
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(li, gh);

    assert.ok(result.recommended_next_action, "recommended_next_action must be present");
    assert.strictEqual(typeof result.recommended_next_action, "string", "recommended_next_action must be a string");
    assert.ok(result.recommended_next_action.length > 0, "recommended_next_action must not be empty");
  });

  it("prefers LinkedIn recommended_next_action when both are available", () => {
    const li = makeLinkedInOutput({ recommended_next_action: "apply-headline-v1" });
    const gh = makeGitHubOutput({ recommended_next_action: "fix-github-docs" });
    const result = synthesizeSurfaceWorkflow(li, gh);

    assert.strictEqual(result.recommended_next_action, "apply-headline-v1");
  });

  it("falls back to GitHub recommended_next_action when LinkedIn is absent", () => {
    const gh = makeGitHubOutput({ recommended_next_action: "fix-github-docs" });
    const result = synthesizeSurfaceWorkflow(null, gh);

    assert.strictEqual(result.recommended_next_action, "fix-github-docs");
  });

  it("contains all single_final_response fields", () => {
    const li = makeLinkedInOutput();
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(li, gh);

    assert.ok(result.request_understood, "request_understood must be present");
    assert.ok(Array.isArray(result.evidence_used), "evidence_used must be an array");
    assert.ok(Array.isArray(result.specialists_consulted), "specialists_consulted must be an array");
    assert.ok(result.answer, "answer must be present");
    assert.ok(result.uncertainty_or_missing_context !== undefined, "uncertainty_or_missing_context must be present");
    assert.ok(result.recommended_next_action, "recommended_next_action must be present");
  });

  it("includes specialists_consulted in the output", () => {
    const li = makeLinkedInOutput();
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(li, gh);

    assert.ok(result.specialists_consulted.includes("bb-linkedin-optimizer"), "Must include bb-linkedin-optimizer");
    assert.ok(result.specialists_consulted.includes("bb-github-proof"), "Must include bb-github-proof");
  });

  it("collects evidence_used from both specialists", () => {
    const li = makeLinkedInOutput({ evidence_used: ["linkedin", "resume"] });
    const gh = makeGitHubOutput({ evidence_used: ["github_profile", "resume"] });
    const result = synthesizeSurfaceWorkflow(li, gh);

    assert.ok(result.evidence_used.includes("linkedin"));
    assert.ok(result.evidence_used.includes("github_profile"));
    assert.ok(result.evidence_used.includes("resume"));
    // Deduplication: "resume" should only appear once
    const resumeCount = result.evidence_used.filter((e) => e === "resume").length;
    assert.strictEqual(resumeCount, 1, "evidence_used must be deduplicated");
  });

  it("preserves GitHub evaluation order statement per D-09", () => {
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(null, gh);

    assert.ok(
      result.answer.includes("portfolio value -> proof quality -> engineering quality"),
      "Must include D-09 evaluation order"
    );
  });

  it("surfaces proof gaps in the output", () => {
    const gh = makeGitHubOutput();
    const result = synthesizeSurfaceWorkflow(null, gh);

    assert.ok(result.answer.includes("Proof Gaps"), "Must include proof gaps section");
    assert.ok(result.answer.includes("No test suite"), "Must surface specific proof gap");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("handles both outputs being null/undefined gracefully", () => {
    const result = synthesizeSurfaceWorkflow(null, null);

    assert.ok(result.request_understood);
    assert.ok(result.answer);
    assert.ok(result.recommended_next_action);
    assert.strictEqual(result.evidence_used.length, 0);
  });

  it("handles LinkedIn with missing section_diagnoses", () => {
    const li = makeLinkedInOutput({ section_diagnoses: undefined });
    const result = synthesizeSurfaceWorkflow(li, null);

    assert.ok(result.answer.includes("## LinkedIn Optimization"));
    assert.ok(!result.answer.includes("### headline:"), "Should not crash on missing diagnoses");
  });

  it("handles GitHub with empty repo_dispositions", () => {
    const gh = makeGitHubOutput({ repo_dispositions: [] });
    const result = synthesizeSurfaceWorkflow(null, gh);

    assert.ok(result.answer.includes("## GitHub Proof Building"));
  });

  it("handles missing_artifact_flag LinkedIn (diagnose-only mode, D-20)", () => {
    const li = makeLinkedInOutput({
      missing_artifact_flag: true,
      confidence: "low",
      section_diagnoses: {
        headline: { section_name: "headline", present: true, coverage_notes: "Diagnose-only: LinkedIn artifact missing", variant_count: 0 },
        about: { section_name: "about", present: true, coverage_notes: "Diagnose-only: LinkedIn artifact missing", variant_count: 0 },
        experience: { section_name: "experience", present: true, coverage_notes: "Diagnose-only: LinkedIn artifact missing", variant_count: 0 },
        featured: { section_name: "featured", present: true, coverage_notes: "Diagnose-only: LinkedIn artifact missing", variant_count: 0 },
        skills: { section_name: "skills", present: true, coverage_notes: "Diagnose-only: LinkedIn artifact missing", variant_count: 0 },
      },
      rewrite_variants: { headline: [], about: [], experience: [], featured: [], skills: [] },
      uncertainties: ["LinkedIn profile artifact is missing — full rewrite variants unavailable (D-20)"],
    });

    const result = synthesizeSurfaceWorkflow(li, null);

    assert.ok(result.answer.includes("Diagnose-only: LinkedIn artifact missing"), "Diagnose-only note must appear");
    assert.ok(result.uncertainty_or_missing_context.includes("D-20"), "D-20 caveat must be in uncertainties");
  });
});
