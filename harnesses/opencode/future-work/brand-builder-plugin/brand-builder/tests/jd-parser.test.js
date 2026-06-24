/**
 * Brand Builder JD Parser Contract Tests
 *
 * Covers ROLE-01 and ROLE-02 for the deterministic job-description parser.
 * Verifies the parseJobDescription contract from 04-RESEARCH.md:
 *   parseJobDescription({ roleTarget, jobDescriptionText, sourceType, sourceQuality }) => {
 *     roleTitle, seniority, sourceType, sourceQuality,
 *     mustHaveSkills, preferredSkills, responsibilities, qualifications,
 *     experienceSignals, domainContext, proofExpectations, toolingTerms
 *   }
 *
 * The parseJobDescription import will fail until jd-parser.js is implemented —
 * this is the TDD RED phase.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { parseJobDescription } = require("../role-fit/jd-parser.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Fixture 1: Markdown JD with explicit sections per D-02.
 * Has Must Have, Preferred, Responsibilities, and Qualifications headings.
 */
const MARKDOWN_JD = `# Senior Frontend Engineer

## Must Have
- 5+ years of frontend development experience
- React and TypeScript expertise
- Experience with AWS services
- Strong understanding of web performance

## Preferred
- GraphQL experience
- Open source contributions
- Figma proficiency

## Responsibilities
- Lead frontend architecture decisions
- Mentor junior developers
- Collaborate with design team
- Drive technical roadmap for the frontend platform

## Qualifications
- Bachelor's degree in Computer Science or equivalent
- Strong portfolio demonstrating complex UI work
- Published technical writing or speaking experience`;

/**
 * Fixture 2: Pasted plain text JD with inline role title, seniority,
 * domain, and tooling terms. Exercises the heading-free fallback heuristics
 * from D-01 and D-03.
 */
const PASTED_TEXT_JD = `We're looking for a Staff Backend Engineer to join our team. You'll need 8+ years of experience with distributed systems. Must have strong Go and Kubernetes skills. Experience with PostgreSQL and AWS is preferred. You should have a track record of open source contributions and published work. Our domain is fintech infrastructure.`;

/**
 * Fixture 3: Partial/truncated JD with only a Must Have section.
 * Exercises graceful fallback per D-03 and 04-RESEARCH.md open question 1.
 */
const PARTIAL_JD = `# Junior Data Scientist

## Must Have
- Python proficiency
- Experience with SQL
- Understanding of statistical modeling`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseJobDescription", () => {
  // --- Test 1: Contract shape and dual-input parse (D-03) ---
  it("parses both markdown and pasted text JDs into the identical structured field set", () => {
    const markdownResult = parseJobDescription({
      roleTarget: "Senior Frontend Engineer",
      jobDescriptionText: MARKDOWN_JD,
      sourceType: "text",
      sourceQuality: "full",
    });

    const pastedResult = parseJobDescription({
      roleTarget: "Staff Backend Engineer",
      jobDescriptionText: PASTED_TEXT_JD,
      sourceType: "text",
      sourceQuality: "full",
    });

    // Required keys from 04-RESEARCH.md target model
    const requiredKeys = [
      "roleTitle",
      "seniority",
      "sourceType",
      "sourceQuality",
      "mustHaveSkills",
      "preferredSkills",
      "responsibilities",
      "qualifications",
      "experienceSignals",
      "domainContext",
      "proofExpectations",
      "toolingTerms",
    ];

    for (const result of [markdownResult, pastedResult]) {
      for (const key of requiredKeys) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(result, key),
          `Result missing required key: ${key}`
        );
      }

      // Extraneous keys test — no unexpected properties
      const actualKeys = Object.keys(result);
      for (const key of actualKeys) {
        assert.ok(
          requiredKeys.includes(key),
          `Result contains unexpected key: ${key}`
        );
      }

      // Array fields must be arrays (may be empty)
      const arrayFields = [
        "mustHaveSkills",
        "preferredSkills",
        "responsibilities",
        "qualifications",
        "experienceSignals",
        "domainContext",
        "proofExpectations",
        "toolingTerms",
      ];
      for (const field of arrayFields) {
        assert.ok(Array.isArray(result[field]), `${field} must be an array`);
      }

      // sourceType and sourceQuality must be carried through
      assert.strictEqual(result.sourceType, "text");
      assert.strictEqual(result.sourceQuality, "full");
    }
  });

  // --- Test 2: Section separation into distinct arrays (D-02) ---
  it("separates must-have, preferred, responsibilities, and qualifications into distinct arrays", () => {
    const result = parseJobDescription({
      roleTarget: "Senior Frontend Engineer",
      jobDescriptionText: MARKDOWN_JD,
      sourceType: "markdown",
      sourceQuality: "full",
    });

    // Must-have items detected from Must Have section
    assert.ok(result.mustHaveSkills.length > 0, "mustHaveSkills must not be empty for marked JD");
    assert.ok(
      result.mustHaveSkills.some((s) => s.toLowerCase().includes("react")),
      "mustHaveSkills must contain React"
    );
    assert.ok(
      result.mustHaveSkills.some((s) => s.toLowerCase().includes("typescript")),
      "mustHaveSkills must contain TypeScript"
    );
    assert.ok(
      result.mustHaveSkills.some((s) => s.toLowerCase().includes("aws")),
      "mustHaveSkills must contain AWS"
    );

    // Preferred items detected from Preferred section
    assert.ok(result.preferredSkills.length > 0, "preferredSkills must not be empty");
    assert.ok(
      result.preferredSkills.some((s) => s.toLowerCase().includes("graphql")),
      "preferredSkills must contain GraphQL"
    );
    assert.ok(
      result.preferredSkills.some((s) => s.toLowerCase().includes("open source")),
      "preferredSkills must contain open source"
    );

    // Responsibilities detected from Responsibilities section
    assert.ok(result.responsibilities.length > 0, "responsibilities must not be empty");
    assert.ok(
      result.responsibilities.some((s) => s.toLowerCase().includes("mentor")),
      "responsibilities must contain mentoring"
    );

    // Qualifications detected from Qualifications section
    assert.ok(result.qualifications.length > 0, "qualifications must not be empty");
    assert.ok(
      result.qualifications.some((s) => s.toLowerCase().includes("bachelor")),
      "qualifications must contain degree requirement"
    );

    // Must-have and preferred must NOT overlap
    const mustHaveLower = result.mustHaveSkills.map((s) => s.toLowerCase());
    const preferredLower = result.preferredSkills.map((s) => s.toLowerCase());
    const overlap = mustHaveLower.filter((s) => preferredLower.includes(s));
    assert.strictEqual(overlap.length, 0, "mustHaveSkills and preferredSkills must not overlap");
  });

  // --- Test 3: Heading-free prose fallback (D-01, D-02) ---
  it("populates buckets from heading-free prose via keyword heuristics", () => {
    const result = parseJobDescription({
      roleTarget: "Staff Backend Engineer",
      jobDescriptionText: PASTED_TEXT_JD,
      sourceType: "text",
      sourceQuality: "full",
    });

    // roleTitle from roleTarget
    assert.strictEqual(result.roleTitle, "Staff Backend Engineer");

    // seniority extracted from title/body keywords
    assert.strictEqual(result.seniority, "staff");

    // mustHaveSkills from "must have" phrase
    assert.ok(result.mustHaveSkills.length > 0, "mustHaveSkills must be populated from prose");
    assert.ok(
      result.mustHaveSkills.some((s) => s.toLowerCase().includes("go")),
      "mustHaveSkills must contain Go"
    );
    assert.ok(
      result.mustHaveSkills.some((s) => s.toLowerCase().includes("kubernetes")),
      "mustHaveSkills must contain Kubernetes"
    );

    // preferredSkills from "preferred" phrase
    assert.ok(result.preferredSkills.length > 0, "preferredSkills must be populated from prose");
    assert.ok(
      result.preferredSkills.some((s) => s.toLowerCase().includes("postgresql")),
      "preferredSkills must contain PostgreSQL"
    );

    // domainContext extracted from domain keyword
    assert.ok(result.domainContext.length > 0, "domainContext must be populated");
    assert.ok(
      result.domainContext.some((s) => s.toLowerCase().includes("fintech")),
      "domainContext must contain fintech"
    );

    // proofExpectations from proof-related keywords
    assert.ok(result.proofExpectations.length > 0, "proofExpectations must be populated");
    assert.ok(
      result.proofExpectations.some((s) => s.toLowerCase().includes("open source")),
      "proofExpectations must contain open source"
    );
    assert.ok(
      result.proofExpectations.some((s) => s.toLowerCase().includes("published")),
      "proofExpectations must contain published work"
    );

    // toolingTerms from recognized tool/product terms
    assert.ok(result.toolingTerms.length > 0, "toolingTerms must be populated");
    assert.ok(
      result.toolingTerms.some((s) => s.toLowerCase().includes("go")),
      "toolingTerms must contain Go"
    );
    assert.ok(
      result.toolingTerms.some((s) => s.toLowerCase().includes("kubernetes")),
      "toolingTerms must contain Kubernetes"
    );
    assert.ok(
      result.toolingTerms.some((s) => s.toLowerCase().includes("aws")),
      "toolingTerms must contain AWS"
    );
  });

  // --- Test 4: Partial fetch graceful fallback (D-03 + research OQ1) ---
  it("preserves sourceQuality: partial and returns empty arrays when sections are missing", () => {
    const result = parseJobDescription({
      roleTarget: "Junior Data Scientist",
      jobDescriptionText: PARTIAL_JD,
      sourceType: "markdown",
      sourceQuality: "partial",
    });

    // sourceQuality preserved as provided
    assert.strictEqual(result.sourceQuality, "partial");

    // mustHaveSkills populated from available section
    assert.ok(result.mustHaveSkills.length > 0, "mustHaveSkills must have items from Must Have section");
    assert.ok(
      result.mustHaveSkills.some((s) => s.toLowerCase().includes("python")),
      "mustHaveSkills must contain Python"
    );

    // Missing sections produce empty arrays, not exceptions
    assert.ok(Array.isArray(result.preferredSkills), "preferredSkills must be an array");
    assert.strictEqual(result.preferredSkills.length, 0, "preferredSkills must be empty when section is missing");

    assert.ok(Array.isArray(result.responsibilities), "responsibilities must be an array");
    assert.strictEqual(result.responsibilities.length, 0, "responsibilities must be empty when section is missing");

    assert.ok(Array.isArray(result.qualifications), "qualifications must be an array");
    assert.strictEqual(result.qualifications.length, 0, "qualifications must be empty when section is missing");

    // All required keys must still be present
    const requiredKeys = [
      "roleTitle", "seniority", "sourceType", "sourceQuality",
      "mustHaveSkills", "preferredSkills", "responsibilities", "qualifications",
      "experienceSignals", "domainContext", "proofExpectations", "toolingTerms",
    ];
    for (const key of requiredKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(result, key),
        `Partial result missing required key: ${key}`
      );
    }
  });

  // --- Test 5: Deduplication (D-02 behavior) ---
  it("deduplicates values case-insensitively while preserving first-seen casing", () => {
    const result = parseJobDescription({
      roleTarget: "Full-Stack Developer",
      jobDescriptionText: "Must have: React, TypeScript, react, typescript, AWS, aws",
      sourceType: "text",
      sourceQuality: "full",
    });

    // Count occurrences of deduplicated terms
    const reactMatches = result.mustHaveSkills.filter(
      (s) => s.toLowerCase() === "react"
    );
    const tsMatches = result.mustHaveSkills.filter(
      (s) => s.toLowerCase() === "typescript"
    );
    const awsMatches = result.mustHaveSkills.filter(
      (s) => s.toLowerCase() === "aws"
    );

    assert.strictEqual(reactMatches.length, 1, "React must appear once, deduplicated");
    assert.strictEqual(tsMatches.length, 1, "TypeScript must appear once, deduplicated");
    assert.strictEqual(awsMatches.length, 1, "AWS must appear once, deduplicated");

    // First-seen casing preserved: "React" (first), not "react" (second)
    assert.strictEqual(reactMatches[0], "React");
    assert.strictEqual(tsMatches[0], "TypeScript");
    assert.strictEqual(awsMatches[0], "AWS");
  });

  // --- Test 6: Seniority detection from role/title keywords ---
  it("detects seniority from role-title keywords", () => {
    const testCases = [
      { roleTarget: "Junior React Developer", expected: "junior" },
      { roleTarget: "Senior Platform Engineer", expected: "senior" },
      { roleTarget: "Staff ML Engineer", expected: "staff" },
      { roleTarget: "Principal Architect", expected: "principal" },
      { roleTarget: "Lead Frontend", expected: "lead" },
      { roleTarget: "Engineering Manager", expected: "manager" },
      { roleTarget: "Mid-level Backend Dev", expected: "mid" },
      { roleTarget: "Intern Software Engineer", expected: "intern" },
    ];

    for (const { roleTarget, expected } of testCases) {
      const result = parseJobDescription({
        roleTarget,
        jobDescriptionText: "Some job description text.",
        sourceType: "text",
        sourceQuality: "full",
      });
      assert.strictEqual(
        result.seniority,
        expected,
        `roleTarget "${roleTarget}" should detect seniority "${expected}", got "${result.seniority}"`
      );
    }
  });

  // --- Test 7: Missing section entirely yields empty arrays, no throw ---
  it("returns empty arrays for all buckets when no structured sections exist and no keyword matches", () => {
    const result = parseJobDescription({
      roleTarget: "Unknown Role",
      jobDescriptionText: "This is a very generic description with no useful keywords.",
      sourceType: "text",
      sourceQuality: "full",
    });

    assert.strictEqual(result.mustHaveSkills.length, 0);
    assert.strictEqual(result.preferredSkills.length, 0);
    assert.strictEqual(result.responsibilities.length, 0);
    assert.strictEqual(result.qualifications.length, 0);

    // roleTitle should fall back to roleTarget
    assert.strictEqual(result.roleTitle, "Unknown Role");
  });
});
