/**
 * Deterministic Job-Description Parser
 *
 * Pure CommonJS module that accepts pasted text or normalized markdown and
 * returns a structured target model for downstream role-fit scoring.
 *
 * Exported interface:
 *   parseJobDescription({ roleTarget, jobDescriptionText, sourceType, sourceQuality }) => {
 *     roleTitle, seniority, sourceType, sourceQuality,
 *     mustHaveSkills, preferredSkills, responsibilities, qualifications,
 *     experienceSignals, domainContext, proofExpectations, toolingTerms
 *   }
 *
 * This module stays deterministic and independently testable. It does not
 * import retrieval, repository, or orchestrator files.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Section heading patterns for structured JD parsing. */
const SECTION_PATTERNS = [
  {
    keys: ["mustHaveSkills"],
    pattern: /^(?:##\s*)?must\s+(?:have|haves|haves?\b)\s*$/i,
  },
  {
    keys: ["mustHaveSkills"],
    pattern: /^(?:##\s*)?required\s*(?:skills|experience|qualifications)?\s*$/i,
  },
  {
    keys: ["mustHaveSkills"],
    pattern: /^(?:##\s*)?requirements?\s*$/i,
  },
  {
    keys: ["preferredSkills"],
    pattern: /^(?:##\s*)?preferred\s*(?:skills|experience|qualifications)?\s*$/i,
  },
  {
    keys: ["preferredSkills"],
    pattern: /^(?:##\s*)?bonus\s*(?:points|skills|experience)?\s*$/i,
  },
  {
    keys: ["preferredSkills"],
    pattern: /^(?:##\s*)?nice\s+to\s+(?:have|haves)\s*$/i,
  },
  {
    keys: ["responsibilities"],
    pattern: /^(?:##\s*)?responsibilities?\s*$/i,
  },
  {
    keys: ["responsibilities"],
    pattern: /^(?:##\s*)?what\s+you(?:'ll|\s+will)\s+do\s*$/i,
  },
  {
    keys: ["qualifications"],
    pattern: /^(?:##\s*)?qualifications?\s*$/i,
  },
  {
    keys: ["qualifications"],
    pattern: /^(?:##\s*)?about\s+you\s*$/i,
  },
];

/** Seniority keywords in priority order (prefer longer matches first). */
const SENIORITY_KEYWORDS = [
  { word: "principal", seniority: "principal" },
  { word: "staff", seniority: "staff" },
  { word: "senior", seniority: "senior" },
  { word: "lead", seniority: "lead" },
  { word: "manager", seniority: "manager" },
  { word: "mid-level", seniority: "mid" },
  { word: "mid", seniority: "mid" },
  { word: "junior", seniority: "junior" },
  { word: "intern", seniority: "intern" },
];

/**
 * Known tooling/product terms for keyword-fallback extraction.
 * Keep this list broad enough to catch common JD tooling references.
 */
const TOOLING_TERMS = [
  "React", "Angular", "Vue", "Svelte", "Next.js", "Nuxt", "Remix",
  "TypeScript", "JavaScript", "Node.js", "Deno", "Bun",
  "Python", "Go", "Rust", "Java", "Kotlin", "Scala", "Swift",
  "C#", "C++", "Ruby", "PHP", "Elixir",
  "GraphQL", "REST", "gRPC", "WebSocket",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "DynamoDB", "Cassandra",
  "SQL", "NoSQL",
  "AWS", "Azure", "GCP", "Cloudflare", "Vercel", "Netlify",
  "Docker", "Kubernetes", "Terraform", "Helm", "Ansible",
  "Figma", "Sketch", "Adobe XD", "Storybook",
  "Git", "GitHub", "GitLab", "Bitbucket",
  "CI/CD", "Jenkins", "GitHub Actions", "CircleCI",
  "Jest", "Cypress", "Playwright", "Vitest", "Mocha",
  "Webpack", "Vite", "esbuild", "Rollup", "Parcel",
  "Tailwind", "Bootstrap", "Material UI", "Chakra",
  "Prisma", "Drizzle", "TypeORM", "Sequelize",
  "tRPC", "Apollo", "Relay",
  "Linux", "Unix",
  "Kafka", "RabbitMQ", "SQS", "Pub/Sub",
  "Datadog", "Sentry", "Prometheus", "Grafana", "ELK",
  "Snowflake", "BigQuery", "Redshift", "Spark", "Hadoop",
  "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy",
  "Tableau", "Looker", "Power BI", "dbt",
  "Jira", "Confluence", "Notion", "Linear",
  "Slack", "Discord", "Teams",
];

/** Proof-expectation keywords for keyword-fallback extraction. */
const PROOF_KEYWORDS = [
  "portfolio",
  "github",
  "open source",
  "open-source",
  "case study",
  "published work",
  "published",
  "technical blog",
  "speaking",
  "conference talk",
  "side project",
  "personal project",
  "code sample",
  "repo",
  "repository",
  "contribution",
];

/** Domain-context indicators for keyword-fallback extraction. */
const DOMAIN_KEYWORDS = [
  "domain",
  "industry",
  "sector",
  "vertical",
  "fintech",
  "healthtech",
  "edtech",
  "e-commerce",
  "saas",
  "infrastructure",
  "platform",
  "marketplace",
  "consumer",
  "enterprise",
  "b2b",
  "b2c",
  "security",
  "compliance",
  "regulatory",
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize text for comparison: lowercase and collapse whitespace.
 */
function normalize(str) {
  return str.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Strip markdown heading markers (##, ###, etc.) and leading/trailing whitespace.
 */
function stripHeading(line) {
  return line.replace(/^#+\s*/, "").trim();
}

/**
 * Strip bullet markers (-, *, •, +, or numbered lists like "1.", "2)").
 */
function stripBullet(line) {
  return line
    .replace(/^[\s]*[-*•+]\s*/, "")
    .replace(/^[\s]*\d+[.)]\s*/, "")
    .trim();
}

/**
 * Parse a bullet-point line into a clean item string.
 * Returns null if the line is not a bullet.
 */
function parseBullet(line) {
  const trimmed = line.trim();
  if (
    trimmed.startsWith("-") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("•") ||
    trimmed.startsWith("+") ||
    /^\d+[.)]\s/.test(trimmed)
  ) {
    const cleaned = stripBullet(trimmed);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Deduplicate an array case-insensitively, preserving first-seen casing.
 */
function deduplicate(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalize(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Extract lines belonging to a section after a heading match, until the
 * next heading or end of input.
 */
function collectSectionItems(lines, startIdx) {
  const items = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Stop at next heading
    if (/^#+\s/.test(line.trim())) {
      break;
    }
    const bullet = parseBullet(line);
    if (bullet) {
      items.push(bullet);
    }
  }
  return items;
}

/**
 * Parse sections from a JD text that has structured headings.
 * Returns partial result object with categorized arrays.
 */
function parseSections(lines) {
  const result = {
    mustHaveSkills: [],
    preferredSkills: [],
    responsibilities: [],
    qualifications: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const stripped = stripHeading(line);

    for (const section of SECTION_PATTERNS) {
      if (section.pattern.test(stripped)) {
        const items = collectSectionItems(lines, i + 1);
        for (const key of section.keys) {
          result[key].push(...items);
        }
        break; // one section per line
      }
    }
  }

  return result;
}

/**
 * Detect seniority from text using keyword matching.
 */
function detectSeniority(roleTarget, fullText) {
  const searchText = normalize(roleTarget + " " + fullText);
  for (const { word, seniority } of SENIORITY_KEYWORDS) {
    if (searchText.includes(normalize(word))) {
      return seniority;
    }
  }
  return "mid"; // default fallback
}

/**
 * Extract tooling terms from text by matching against known tooling names.
 */
function extractToolingTerms(text) {
  const found = [];
  const normalizedText = normalize(text);

  for (const term of TOOLING_TERMS) {
    const normalizedTerm = normalize(term);
    // Use word-boundary-aware matching
    if (normalizedText.includes(normalizedTerm)) {
      found.push(term);
    }
  }

  // Also check original text for exact matches (preserves casing)
  const extraTerms = [];
  for (const term of TOOLING_TERMS) {
    if (normalizedText.includes(normalize(term))) {
      // Find the actual casing used in the source
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const match = text.match(regex);
      if (match) {
        extraTerms.push(match[0]);
      }
    }
  }

  return deduplicate(extraTerms);
}

/**
 * Extract proof-expectation items from prose text.
 * Matches proof-related keywords that appear in the text.
 */
function extractProofExpectations(text) {
  const found = [];
  const lowerText = text.toLowerCase();

  for (const keyword of PROOF_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      // Try to extract the surrounding phrase (up to 60 chars of context)
      const idx = lowerText.indexOf(keyword);
      const start = Math.max(0, idx - 30);
      const end = Math.min(lowerText.length, idx + keyword.length + 30);
      let context = lowerText.slice(start, end).trim();
      // Capitalize first letter for readability
      context = context.charAt(0).toUpperCase() + context.slice(1);
      found.push(context);
    }
  }

  return deduplicate(found);
}

/**
 * Extract domain-context items from prose text.
 */
function extractDomainContext(text) {
  const found = [];
  const lowerText = text.toLowerCase();

  // Named domains (fintech, healthtech, etc.)
  const domainNames = [
    "fintech", "healthtech", "edtech", "agritech", "biotech",
    "e-commerce", "ecommerce", "saas", "paas", "iaas",
  ];
  for (const domain of domainNames) {
    if (lowerText.includes(domain)) {
      found.push(domain.charAt(0).toUpperCase() + domain.slice(1));
    }
  }

  // Domain indicator phrases
  for (const indicator of DOMAIN_KEYWORDS) {
    if (lowerText.includes(indicator)) {
      const idx = lowerText.indexOf(indicator);
      const start = Math.max(0, idx - 10);
      const end = Math.min(lowerText.length, idx + indicator.length + 40);
      let context = lowerText.slice(start, end).trim();
      // Skip if already captured as a named domain
      if (!domainNames.some((d) => context.includes(d))) {
        found.push(context.charAt(0).toUpperCase() + context.slice(1));
      }
    }
  }

  return deduplicate(found);
}

/**
 * Extract experience signals (years of experience mentions, etc.).
 */
function extractExperienceSignals(text) {
  const signals = [];
  const lowerText = text.toLowerCase();

  // Years of experience patterns
  const yearsPattern = /(\d+)[\+]*\s*(?:years|yrs)(?:\s+of)?\s*(?:experience|exp)/gi;
  let match;
  while ((match = yearsPattern.exec(text)) !== null) {
    signals.push(match[0].trim());
  }

  // Seniority-level indicators in prose
  if (lowerText.includes("senior-level") || lowerText.includes("senior level")) {
    signals.push("Senior-level experience expected");
  }
  if (lowerText.includes("leadership")) {
    signals.push("Leadership experience expected");
  }
  if (lowerText.includes("team lead") || lowerText.includes("tech lead")) {
    signals.push("Team/tech lead experience expected");
  }

  return deduplicate(signals);
}

/**
 * Extract skills from prose using "must have" and "preferred" phrase detection.
 * Used as fallback when structured headings are absent.
 */
function extractSkillsFromProse(lines) {
  const result = {
    mustHaveSkills: [],
    preferredSkills: [],
  };

  const fullText = lines.join("\n");
  const lowerText = fullText.toLowerCase();

  // "Must have" phrases: extract items after "must have" or "required"
  const mustPatterns = [
    /must\s+have\s*(?:[:;])?\s*([^.!?\n]+)/gi,
    /required\s*(?:[:;])?\s*([^.!?\n]+)/gi,
    /requirements?\s*(?:[:;])?\s*([^.!?\n]+)/gi,
  ];

  for (const pattern of mustPatterns) {
    let m;
    while ((m = pattern.exec(fullText)) !== null) {
      const phrase = m[1].trim();
      if (phrase.length > 2) {
        // Split on commas/and to get individual items
        const items = phrase.split(/(?:,|\band\b|;)/).map((s) => s.trim()).filter(Boolean);
        result.mustHaveSkills.push(...items);
      }
    }
  }

  // "Preferred" phrases — match both "preferred: X, Y" and "X is preferred"
  const prefPatterns = [
    // Items before "is/are preferred" (e.g., "Experience with X and Y is preferred")
    /([^.!?\n]+)\s+(?:is|are)\s+preferred/gi,
    // Items after "preferred:" (e.g., "Preferred: X, Y, Z")
    /preferred\s*(?:[:;])?\s*([^.!?\n]+)/gi,
    /bonus\s*(?:[:;])?\s*([^.!?\n]+)/gi,
    /nice\s+to\s+have\s*(?:[:;])?\s*([^.!?\n]+)/gi,
  ];

  for (const pattern of prefPatterns) {
    let m;
    while ((m = pattern.exec(fullText)) !== null) {
      const phrase = m[1].trim();
      if (phrase.length > 2) {
        const items = phrase.split(/(?:,|\band\b|;)/).map((s) => s.trim()).filter(Boolean);
        result.preferredSkills.push(...items);
      }
    }
  }

  // Deduplicate
  result.mustHaveSkills = deduplicate(result.mustHaveSkills);
  result.preferredSkills = deduplicate(result.preferredSkills);

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a job description into a structured target model.
 *
 * @param {Object} params
 * @param {string}  params.roleTarget         - Target role title (e.g., "Senior Frontend Engineer")
 * @param {string}  params.jobDescriptionText - JD content as markdown or plain text
 * @param {string}  [params.sourceType='text'] - Source type: 'text', 'markdown', 'fetched'
 * @param {string}  [params.sourceQuality='full'] - Source quality: 'full' or 'partial'
 * @returns {Object} Structured parsed target model with all required keys.
 */
function parseJobDescription({
  roleTarget,
  jobDescriptionText,
  sourceType = "text",
  sourceQuality = "full",
}) {
  if (!jobDescriptionText || typeof jobDescriptionText !== "string") {
    return emptyResult(roleTarget || "Unknown Role", sourceType, sourceQuality);
  }

  const lines = jobDescriptionText.split("\n");
  const fullText = jobDescriptionText;

  // 1. roleTitle — from roleTarget, fall back to first heading/first line
  let roleTitle = roleTarget || "";
  if (!roleTitle) {
    // Try first heading
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#+\s/.test(trimmed)) {
        roleTitle = stripHeading(trimmed);
        break;
      }
    }
    // Fall back to first non-empty line
    if (!roleTitle) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("//")) {
          roleTitle = trimmed;
          break;
        }
      }
    }
  }

  // 2. seniority — from role/title keywords
  const seniority = detectSeniority(roleTarget, fullText);

  // 3. Parse structured sections if present
  const sections = parseSections(lines);

  // 4. Prose fallback for skills (when structured headings absent)
  const proseSkills = extractSkillsFromProse(lines);

  // Merge: prefer section-based extraction over prose fallback
  const mustHaveSkills = sections.mustHaveSkills.length > 0
    ? sections.mustHaveSkills
    : proseSkills.mustHaveSkills;
  const preferredSkills = sections.preferredSkills.length > 0
    ? sections.preferredSkills
    : proseSkills.preferredSkills;

  // 5. Keyword-fallback extractions
  const experienceSignals = extractExperienceSignals(fullText);
  const domainContext = extractDomainContext(fullText);
  const proofExpectations = extractProofExpectations(fullText);
  const toolingTerms = extractToolingTerms(fullText);

  // 6. Deduplicate all arrays
  return {
    roleTitle,
    seniority,
    sourceType,
    sourceQuality,
    mustHaveSkills: deduplicate(mustHaveSkills),
    preferredSkills: deduplicate(preferredSkills),
    responsibilities: deduplicate(sections.responsibilities),
    qualifications: deduplicate(sections.qualifications),
    experienceSignals,
    domainContext,
    proofExpectations,
    toolingTerms,
  };
}

/**
 * Return an empty result with all required keys and empty arrays.
 */
function emptyResult(roleTarget, sourceType, sourceQuality) {
  return {
    roleTitle: roleTarget || "Unknown Role",
    seniority: "mid",
    sourceType: sourceType || "text",
    sourceQuality: sourceQuality || "full",
    mustHaveSkills: [],
    preferredSkills: [],
    responsibilities: [],
    qualifications: [],
    experienceSignals: [],
    domainContext: [],
    proofExpectations: [],
    toolingTerms: [],
  };
}

module.exports = { parseJobDescription };
