"use strict";
/**
 * Brand Builder ATS Scan Engine
 *
 * Deterministic ATS keyword/format scanner. Pure function — no DB access,
 * no LLM calls. Takes artifact text + JD keywords and returns:
 *   - keywordCoverage: { matched, missing, score }
 *   - formatChecks: { hasQuantifiedAchievements, hasBulletPoints, hasContactInfo, hasDateRanges }
 *   - overallScore: 0-100 (weighted: 70% keyword, 30% format)
 */

// ---------------------------------------------------------------------------
// Format check regexes
// ---------------------------------------------------------------------------

/** Matches quantified achievements: numbers with %, x, or metric keywords */
const QUANTIFIED_RE = /\b\d+\s*(?:%|x\b|X\b|times|users|clients|revenue|reduction|improvement|increase|decrease|hours|days|weeks|months|years|k\b|m\b|million|billion|thousand)\b/i;

/** Matches common bullet characters at line start */
const BULLET_RE = /^[\s]*[-•*▪◦>]\s+\S/m;

/** Matches contact info patterns: email, phone, LinkedIn URL */
const CONTACT_RE = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|linkedin\.com\/in\/)/i;

/** Matches date ranges: "Jan 2022 – Present", "2019–2023", "2020 - present", "2018 to current"
 *  Requires the range part — does NOT match standalone years like "2020". */
const DATE_RANGE_RE = /\b(19|20)\d{2}\s*[-–—to]+\s*((19|20)\d{2}|present|current|now)\b/gi;

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring match.
 *
 * @param {string} text - the resume text (lowercased)
 * @param {string} keyword - keyword to search for
 * @returns {boolean}
 */
function keywordPresent(text, keyword) {
  if (!keyword || !keyword.trim()) return false;
  return text.includes(keyword.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// runAtsScan — public API
// ---------------------------------------------------------------------------

/**
 * Run a deterministic ATS scan on resume text against JD keywords.
 *
 * @param {object} params
 * @param {string} params.resumeText - full resume text to scan
 * @param {string[]} [params.jdKeywords=[]] - all JD keywords to check coverage for
 * @param {string[]} [params.requiredKeywords=[]] - subset that are must-haves
 * @returns {{
 *   keywordCoverage: { matched: string[], missing: string[], score: number },
 *   formatChecks: {
 *     hasQuantifiedAchievements: boolean,
 *     hasBulletPoints: boolean,
 *     hasContactInfo: boolean,
 *     hasDateRanges: boolean
 *   },
 *   overallScore: number
 * }}
 */
function runAtsScan({ resumeText, jdKeywords = [], requiredKeywords = [] }) {
  const text = typeof resumeText === "string" ? resumeText : "";
  const lowerText = text.toLowerCase();

  // Deduplicate all keywords (union of both arrays, case-insensitive)
  const seen = new Set();
  const allKeywords = [];
  for (const kw of [...jdKeywords, ...requiredKeywords]) {
    const lower = (kw || "").toLowerCase().trim();
    if (lower && !seen.has(lower)) {
      seen.add(lower);
      allKeywords.push(kw.trim());
    }
  }

  // Keyword coverage
  const matched = [];
  const missing = [];
  for (const kw of allKeywords) {
    if (keywordPresent(lowerText, kw)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const keywordScore = allKeywords.length === 0
    ? 100
    : Math.round((matched.length / allKeywords.length) * 100);

  // Format checks (regex-based, deterministic)
  const formatChecks = {
    hasQuantifiedAchievements: QUANTIFIED_RE.test(text),
    hasBulletPoints: BULLET_RE.test(text),
    hasContactInfo: CONTACT_RE.test(text),
    hasDateRanges: DATE_RANGE_RE.test(text),
  };

  // Format score: 25 points per passing check
  const formatScore = Object.values(formatChecks).filter(Boolean).length * 25;

  // Overall score: 70% keyword, 30% format
  const overallScore = Math.round(0.7 * keywordScore + 0.3 * formatScore);

  return {
    keywordCoverage: {
      matched,
      missing,
      score: keywordScore,
    },
    formatChecks,
    overallScore,
  };
}

module.exports = { runAtsScan };
