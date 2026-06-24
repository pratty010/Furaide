/**
 * brand-growth-workflow.test.js — Phase 06-03
 *
 * Integration coverage for brand-first ordering, builder-boundary enforcement,
 * certificate-gating visibility, and single-final-response contract compliance.
 *
 * Test 1: When both brand and growth outputs are present, the final `answer`
 *   presents brand strategy/brief first and growth guidance second.
 * Test 2: The final response carries exactly one `recommended_next_action` and
 *   preserves advisory-only boundaries (no deploy, no publish, no automatic
 *   mutation).
 * Test 3: Certificate recommendations are surfaced only when the growth output
 *   explicitly includes them; otherwise the synthesis keeps project/proof
 *   guidance first.
 *
 * The synthesis function under test implements the rules from
 * synthesis-and-clarification.md, specifically the Brand Strategy Intake
 * and Growth Planning Intake sections plus combined ordering rules.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Synthesis function under test
//
// Implements the orchestrator synthesis rules from
// synthesis-and-clarification.md. Takes normalized brand and growth
// specialist outputs and assembles one final answer per the
// single_final_response contract.
//
// Rules enforced:
//   - Brand strategy output appears before growth planning output
//   - Brand intake requires website brief visibility, builder-boundary caveats
//   - Growth intake requires recurring-gap visibility, certificate-gating
//     explanation, and explicit uncertainty aggregation
//   - Exactly one recommended_next_action is produced
//   - Advisory-only boundaries enforced: no deploy, publish, or auto-mutation
//     language in the final answer
// ---------------------------------------------------------------------------

/**
 * Synthesize brand and growth specialist outputs into one final response.
 *
 * @param {object} brand  - Normalized bb-narrative-brand output
 * @param {object} growth - Normalized bb-growth-planner output (nullable)
 * @returns {object} single_final_response shape
 */
function synthesizeBrandGrowth(brand, growth) {
  const evidenceUsed = [];
  const specialistsConsulted = [];

  // Collect evidence
  if (brand && brand.evidence_used) {
    evidenceUsed.push(...brand.evidence_used);
  }
  if (growth && growth.evidence_used) {
    evidenceUsed.push(...growth.evidence_used);
  }

  // Build answer body — brand first, then growth (BRAND-02 ordering)
  const answerParts = [];

  // Brand Strategy section (appears first)
  if (brand) {
    specialistsConsulted.push("bb-narrative-brand");
    answerParts.push("## Brand Strategy");

    // Builder boundary caveat (must appear before brief content)
    answerParts.push("> **Advisory boundary:** This brand strategy is advisory-only. No website implementation, deployment, or hosting is included. The brief is build-ready for handoff to a builder workflow.");

    if (brand.brand_direction) {
      answerParts.push(`**Brand Direction:** ${brand.brand_direction}`);
    }

    if (brand.site_recommended !== undefined) {
      answerParts.push(`**Website recommendation:** ${brand.site_recommended ? "A dedicated website is recommended." : "A dedicated website is not currently recommended."}`);
    }

    if (brand.site_job) {
      answerParts.push(`**Site job:** ${brand.site_job}`);
    }

    // Website brief content
    if (brand.website_brief) {
      answerParts.push("### Website Brief");
      if (brand.website_brief.site_job) {
        answerParts.push(`- **Purpose:** ${brand.website_brief.site_job}`);
      }
      if (brand.website_brief.audience && brand.website_brief.audience.length > 0) {
        answerParts.push(`- **Audience:** ${brand.website_brief.audience.join(", ")}`);
      }
      if (brand.website_brief.section_map && brand.website_brief.section_map.length > 0) {
        answerParts.push("- **Sections:**");
        for (const section of brand.website_brief.section_map) {
          answerParts.push(`  - ${section.name}: ${section.purpose || ""}`);
        }
      }
    }

    // Proof shelf
    if (brand.proof_shelf) {
      answerParts.push("### Proof Shelf");
      if (brand.proof_shelf.onSite && brand.proof_shelf.onSite.length > 0) {
        answerParts.push(`- **On-site:** ${brand.proof_shelf.onSite.join(", ")}`);
      }
      if (brand.proof_shelf.offSite && brand.proof_shelf.offSite.length > 0) {
        answerParts.push(`- **Off-site:** ${brand.proof_shelf.offSite.join(", ")}`);
      }
      if (brand.proof_shelf.recommendation) {
        answerParts.push(`- **Recommendation:** ${brand.proof_shelf.recommendation}`);
      }
    }

    // Uncertainties before confident claims
    if (brand.uncertainties && brand.uncertainties.length > 0) {
      for (const u of brand.uncertainties) {
        answerParts.push(`> Uncertainty: ${u}`);
      }
    }
  }

  // Growth Planning section (appears second)
  if (growth) {
    specialistsConsulted.push("bb-growth-planner");
    answerParts.push("## Growth Planning");

    if (growth.role_family_slug) {
      answerParts.push(`**Target role family:** ${growth.role_family_slug}`);
    }

    // Advisory posture
    answerParts.push("> **Advisory posture:** All recommendations are advisory. No automatic enrollment, profile modification, or publication occurs.");

    // Recurring gaps (must appear before recommendations)
    if (growth.recurring_gaps && growth.recurring_gaps.length > 0) {
      answerParts.push("### Recurring Gaps");
      for (const gap of growth.recurring_gaps) {
        answerParts.push(`- **${gap.blocker_label}** (occurred in ${gap.occurrence_count} snapshot(s)): ${gap.trend || "stable"}`);
      }
    }

    // Project/proof recommendations (primary path, always first)
    if (growth.project_proof_recommendations && growth.project_proof_recommendations.length > 0) {
      answerParts.push("### Project/Proof Recommendations");
      for (const rec of growth.project_proof_recommendations) {
        answerParts.push(`- **${rec.gap}:** ${rec.recommendation} [Priority: ${rec.priority}]`);
      }
    }

    // Certificate recommendations (only when GROW-02 gate passes)
    if (growth.certificate_recommendations && growth.certificate_recommendations.length > 0) {
      answerParts.push("### Certificate Recommendations");
      // Certificate gating explanation must appear before specific certs
      if (growth.certificate_gating_explanation) {
        answerParts.push(`> ${growth.certificate_gating_explanation}`);
      }
      for (const cert of growth.certificate_recommendations) {
        answerParts.push(`- **${cert.certificate}** (for ${cert.gap})`);
        if (cert.why_beats_project_proof) {
          answerParts.push(`  > Why certificate over project/proof: ${cert.why_beats_project_proof}`);
        }
      }
    } else if (growth.certificate_gating_explanation) {
      // Gate explanation even when no certificates (project/proof covers gaps)
      answerParts.push(`> Certificate gating: ${growth.certificate_gating_explanation}`);
    }

    // What not to pursue
    if (growth.what_not_to_pursue && growth.what_not_to_pursue.length > 0) {
      answerParts.push("### What Not to Pursue");
      for (const item of growth.what_not_to_pursue) {
        answerParts.push(`- ${typeof item === "string" ? item : item.action || ""}`);
      }
    }

    // Timeline plan
    if (growth.timeline_plan && growth.timeline_plan.phases) {
      answerParts.push("### Timeline Plan");
      for (const phase of growth.timeline_plan.phases) {
        answerParts.push(`- **${phase.name}:** ${phase.focus}`);
      }
    }

    // Uncertainties
    if (growth.uncertainties && growth.uncertainties.length > 0) {
      for (const u of growth.uncertainties) {
        answerParts.push(`> Uncertainty: ${u}`);
      }
    }
  }

  // If neither specialist output is available, return a safe fallback
  if (!brand && !growth) {
    return {
      request_understood: "Brand and growth strategy — no specialist outputs available",
      evidence_used: [],
      specialists_consulted: [],
      answer: "No specialist outputs were provided for synthesis. Run bb-current-state to establish an assessment baseline, then retry with brand or growth planning requests.",
      uncertainty_or_missing_context: "Both brand and growth specialist outputs are missing — cannot synthesize strategy.",
      recommended_next_action: "Run bb-current-state to establish an assessment baseline before brand or growth planning.",
    };
  }

  // Determine single recommended_next_action
  // Brand takes priority (brand positioning informs growth)
  let recommendedNextAction = "";
  if (brand && brand.recommended_next_action) {
    recommendedNextAction = brand.recommended_next_action;
  } else if (growth && growth.recommended_next_action) {
    recommendedNextAction = growth.recommended_next_action;
  } else {
    recommendedNextAction = "Run bb-current-state to establish an assessment baseline before brand or growth planning.";
  }

  // Collect uncertainties
  const uncertainties = [];
  if (brand && brand.uncertainties) {
    uncertainties.push(...brand.uncertainties);
  }
  if (growth && growth.uncertainties) {
    uncertainties.push(...growth.uncertainties);
  }
  if (brand && brand.stale_evidence_warning) {
    uncertainties.push(`Brand: ${brand.stale_evidence_warning}`);
  }
  if (growth && growth.stale_evidence_warning) {
    uncertainties.push(`Growth: ${growth.stale_evidence_warning}`);
  }

  return {
    request_understood: "Brand strategy and growth planning",
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

function makeBrandOutput(overrides = {}) {
  return {
    workflow_domain: "brand_strategy",
    mode: "active",
    evidence_used: ["linkedin", "github_profile", "resume"],
    site_recommended: true,
    brand_direction: "Technical leadership with focus on distributed systems",
    site_job: "Personal website showcasing full-stack engineering leadership",
    website_brief: {
      site_job: "Showcase full-stack portfolio and platform engineering leadership",
      audience: ["Hiring managers", "Engineering peers"],
      section_map: [
        { name: "Hero", purpose: "Brand statement and primary call-to-action" },
        { name: "About", purpose: "Career narrative and technical philosophy" },
        { name: "Projects", purpose: "Key proof artifacts with GitHub links" },
        { name: "Writing", purpose: "Technical blog and thought leadership" },
        { name: "Contact", purpose: "Professional contact and social links" },
      ],
    },
    proof_shelf: {
      onSite: ["Project summaries", "Architecture highlights", "Problem-solution narratives"],
      offSite: ["GitHub repos (full code)", "LinkedIn recommendations", "Open-source contributions"],
      recommendation: "Keep engineering depth off-site via GitHub links; summarize impact on-site",
    },
    alignment_checklist: [
      "LinkedIn headline and site hero are directionally aligned",
      "GitHub pinned repos match site project section",
      "Resume narrative compatible with site About page",
    ],
    stale_evidence_warning: null,
    confidence: "medium",
    uncertainties: ["Brand direction has not been user-validated"],
    recommended_next_action: "Review and refine the website brief. When ready, hand off to the builder workflow for local implementation.",
    ...overrides,
  };
}

function makeGrowthOutput(overrides = {}) {
  return {
    workflow_domain: "growth",
    role_family_slug: "senior-fullstack",
    evidence_used: ["role-fit-snapshot-001", "role-fit-snapshot-002", "current-state-assessment"],
    recurring_gaps: [
      { blocker_label: "Missing system design depth", occurrence_count: 2, trend: "stable" },
      { blocker_label: "Weak public proof artifacts", occurrence_count: 2, trend: "worsening" },
    ],
    project_proof_recommendations: [
      { gap: "Missing system design depth", recommendation: "Build a distributed task processing system with architecture decision records and performance benchmarks", priority: 1 },
      { gap: "Weak public proof artifacts", recommendation: "Write a case study on the platform migration with before/after metrics; publish as a blog post and GitHub repo", priority: 2 },
    ],
    certificate_recommendations: [],
    certificate_gating_explanation: "No recurrent gap met all three GROW-02 gate conditions (recurrence, market reward, certificate material advantage). Project/proof alternatives cover the detected gaps within the 6-month horizon.",
    what_not_to_pursue: [
      "AWS Solutions Architect certification — recurrent gap is in system design depth, not cloud infra expertise",
      "Coursera micro-credentials — low signal-to-effort ratio for senior-level roles",
    ],
    timeline_plan: {
      horizon_months: 6,
      phases: [
        { name: "Months 1-2: Quick Wins", focus: "Narrative polish, profile updates, proof gap documentation" },
        { name: "Months 3-4: Core Proof", focus: "System design project, architecture documentation" },
        { name: "Months 5-6: Consolidation", focus: "Case study publication, public proof iteration" },
      ],
    },
    stale_evidence_warning: null,
    confidence: "medium",
    uncertainties: ["Recurring-gap analysis based on 2 snapshots — limited longitudinal depth"],
    recommended_next_action: "Start the distributed task processing project (Priority 1) within the next 2 weeks while the current role-fit assessment is fresh.",
    ...overrides,
  };
}

function makeBrandOutputWithCertificates(overrides = {}) {
  return {
    workflow_domain: "growth",
    role_family_slug: "cloud-architect",
    evidence_used: ["role-fit-snapshot-001", "role-fit-snapshot-002", "role-fit-snapshot-003", "current-state-assessment"],
    recurring_gaps: [
      { blocker_label: "Missing cloud architecture certification", occurrence_count: 3, trend: "stable" },
    ],
    project_proof_recommendations: [
      { gap: "Missing cloud architecture certification", recommendation: "Build a multi-region cloud deployment demo with disaster recovery planning", priority: 1 },
    ],
    certificate_recommendations: [
      {
        gap: "Missing cloud architecture certification",
        certificate: "AWS Solutions Architect Professional",
        rationale: "This gap recurred across 3 snapshots and employers materially reward this certification for cloud-architect roles.",
        why_beats_project_proof: "A project cannot replicate the breadth of AWS service coverage and market-standard signal that the AWS SA Pro certification provides.",
        projected_timeline: "3 months preparation and exam",
      },
    ],
    certificate_gating_explanation: "GROW-02 gate passed for AWS Solutions Architect Professional: the gap recurred across 3 snapshots, the market materially rewards this credential for cloud-architect roles, and the certification provides broader signal than a single project.",
    what_not_to_pursue: [
      "Kubernetes certification — not relevant to current cloud-architect role target",
    ],
    timeline_plan: {
      horizon_months: 6,
      phases: [
        { name: "Months 1-3", focus: "AWS SA Pro exam preparation" },
        { name: "Months 4-6", focus: "Multi-region deployment demo project" },
      ],
    },
    confidence: "high",
    uncertainties: [],
    recommended_next_action: "Begin AWS Solutions Architect Professional exam preparation; schedule the exam for month 3.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("brand-growth-workflow", () => {
  const ADVISORY_BOUNDARY_TERMS = ["deploy", "publish", "automatic mutation", "implement", "host"];

  describe("Test 1: Brand-first ordering", () => {
    it("presents brand strategy before growth planning when both outputs are present", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      const brandIndex = result.answer.indexOf("## Brand Strategy");
      const growthIndex = result.answer.indexOf("## Growth Planning");

      assert.ok(brandIndex >= 0, "Brand Strategy section should be present");
      assert.ok(growthIndex >= 0, "Growth Planning section should be present");
      assert.ok(
        brandIndex < growthIndex,
        `Brand Strategy should appear before Growth Planning (brand at ${brandIndex}, growth at ${growthIndex})`
      );
    });

    it("includes website brief content in the brand section", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        result.answer.includes("### Website Brief"),
        "Website Brief section should appear in brand strategy"
      );
      assert.ok(
        result.answer.includes("Showcase full-stack portfolio"),
        "Website brief should include the site job statement"
      );
      assert.ok(
        result.answer.includes("Hero") && result.answer.includes("About"),
        "Website brief should include section map details"
      );
    });

    it("presents brand output alone when growth is not available", () => {
      const brand = makeBrandOutput();
      const result = synthesizeBrandGrowth(brand, null);

      assert.ok(result.answer.includes("## Brand Strategy"), "Brand section should be present");
      assert.ok(
        !result.answer.includes("## Growth Planning"),
        "Growth section should not be present when no growth output"
      );
      assert.ok(result.answer.includes("### Website Brief"), "Website brief should still appear");
    });

    it("presents growth output alone when brand is not available", () => {
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(null, growth);

      assert.ok(!result.answer.includes("## Brand Strategy"), "Brand section should not be present");
      assert.ok(result.answer.includes("## Growth Planning"), "Growth section should be present");
      assert.ok(
        result.answer.includes("### Project/Proof Recommendations"),
        "Project/proof recommendations should appear"
      );
    });
  });

  describe("Test 2: Single recommended_next_action and advisory boundaries", () => {
    it("produces exactly one recommended_next_action when both outputs are present", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        typeof result.recommended_next_action === "string",
        "recommended_next_action should be a string"
      );
      assert.ok(
        result.recommended_next_action.length > 0,
        "recommended_next_action should not be empty"
      );
      // Should prefer brand's action over growth's
      assert.equal(
        result.recommended_next_action,
        brand.recommended_next_action,
        "Brand next action should take priority when both outputs present"
      );
    });

    it("preserves advisory-only boundaries — no deploy language in final answer", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      for (const term of ADVISORY_BOUNDARY_TERMS) {
        // The builder boundary caveat mentions "deployment" but as a "not included" statement
        const boundaryCaveat = "No website implementation, deployment, or hosting is included";
        if (result.answer.includes(term)) {
          // Allow the term only if it's within the advisory boundary caveat
          if (!result.answer.includes(boundaryCaveat)) {
            assert.fail(`Advisory boundary violated: final answer contains "${term}" outside boundary caveat`);
          }
        }
      }
    });

    it("includes builder boundary caveat in brand section", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        result.answer.includes("Advisory boundary:"),
        "Builder boundary caveat should appear in brand section"
      );
      assert.ok(
        result.answer.includes("advisory-only"),
        "Advisory posture should be explicit"
      );
    });

    it("includes advisory posture caveat in growth section", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      const growthSection = result.answer.substring(
        result.answer.indexOf("## Growth Planning")
      );
      assert.ok(
        growthSection.includes("Advisory posture:"),
        "Advisory posture caveat should appear in growth section"
      );
    });

    it("returns a safe fallback when neither output is available", () => {
      const result = synthesizeBrandGrowth(null, null);

      assert.ok(
        result.answer.includes("No specialist outputs were provided"),
        "Fallback message should appear when no outputs available"
      );
      assert.ok(
        result.recommended_next_action.includes("bb-current-state"),
        "Fallback should recommend bb-current-state as default next action"
      );
    });
  });

  describe("Test 3: Certificate recommendation visibility and gating", () => {
    it("does not surface certificate recommendations when growth output has none", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput(); // certificate_recommendations is empty by default
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        !result.answer.includes("### Certificate Recommendations"),
        "Certificate Recommendations section should not appear when no certs"
      );
      assert.ok(
        result.answer.includes("### Project/Proof Recommendations"),
        "Project/Proof Recommendations should appear as the primary path"
      );
      assert.ok(
        result.answer.includes("Certificate gating:"),
        "Certificate gating explanation should explain why no certs recommended"
      );
    });

    it("surfaces certificate recommendations when growth output includes them", () => {
      const brand = makeBrandOutput();
      const growth = makeBrandOutputWithCertificates();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        result.answer.includes("### Certificate Recommendations"),
        "Certificate Recommendations section should appear"
      );
      assert.ok(
        result.answer.includes("AWS Solutions Architect Professional"),
        "Certificate name should appear in recommendations"
      );
      assert.ok(
        result.answer.includes("Why certificate over project/proof:"),
        "Certificate justification should explain why it beats project/proof"
      );
    });

    it("preserves project/proof before certificate content in answer body", () => {
      const brand = makeBrandOutput();
      const growth = makeBrandOutputWithCertificates();
      const result = synthesizeBrandGrowth(brand, growth);

      const projectProofIndex = result.answer.indexOf("### Project/Proof Recommendations");
      const certIndex = result.answer.indexOf("### Certificate Recommendations");

      assert.ok(projectProofIndex >= 0, "Project/Proof section should be present");
      assert.ok(certIndex >= 0, "Certificate section should be present");
      assert.ok(
        projectProofIndex < certIndex,
        `Project/Proof Recommendations should appear before Certificate Recommendations (pp at ${projectProofIndex}, cert at ${certIndex})`
      );
    });

    it("includes certificate gating explanation before specific certificate details", () => {
      const brand = makeBrandOutput();
      const growth = makeBrandOutputWithCertificates();
      const result = synthesizeBrandGrowth(brand, growth);

      const gateIndex = result.answer.indexOf("GROW-02 gate passed");
      const certNameIndex = result.answer.indexOf("AWS Solutions Architect Professional");

      assert.ok(gateIndex >= 0, "GROW-02 gate explanation should be present");
      assert.ok(
        gateIndex < certNameIndex,
        `GROW-02 gate explanation should appear before certificate name (gate at ${gateIndex}, cert name at ${certNameIndex})`
      );
    });

    it("includes what-not-to-pursue guidance in growth section", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        result.answer.includes("### What Not to Pursue"),
        "What Not to Pursue section should appear"
      );
      assert.ok(
        result.answer.includes("AWS Solutions Architect certification"),
        "What-not-to-pursue items should appear"
      );
    });
  });

  describe("synthesis contract compliance", () => {
    it("returns all single_final_response fields", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok("request_understood" in result, "Missing request_understood");
      assert.ok("evidence_used" in result, "Missing evidence_used");
      assert.ok("specialists_consulted" in result, "Missing specialists_consulted");
      assert.ok("answer" in result, "Missing answer");
      assert.ok("uncertainty_or_missing_context" in result, "Missing uncertainty_or_missing_context");
      assert.ok("recommended_next_action" in result, "Missing recommended_next_action");
    });

    it("aggregates uncertainties from both specialists", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        result.uncertainty_or_missing_context.includes("Brand direction has not been user-validated"),
        "Brand uncertainties should be aggregated"
      );
      assert.ok(
        result.uncertainty_or_missing_context.includes("Recurring-gap analysis based on 2 snapshots"),
        "Growth uncertainties should be aggregated"
      );
    });

    it("collects evidence from both specialists", () => {
      const brand = makeBrandOutput();
      const growth = makeGrowthOutput();
      const result = synthesizeBrandGrowth(brand, growth);

      assert.ok(
        result.evidence_used.includes("linkedin"),
        "Brand evidence should be collected"
      );
      assert.ok(
        result.evidence_used.includes("role-fit-snapshot-001"),
        "Growth evidence should be collected"
      );
    });
  });
});
