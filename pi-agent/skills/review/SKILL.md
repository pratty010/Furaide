---
name: review
description: Review staged or recent code changes. Checks for bugs, style issues, security concerns, and suggests improvements.
---

# Review Skill

Review code changes for quality, correctness, and security.

## Process

1. **Gather changes**: Run `git diff --staged` (or `git diff HEAD~1` for last commit)
2. **Analyze each file**: Check for bugs, edge cases, security issues, style violations
3. **Cross-reference**: Verify changes are consistent across files (types match, imports correct)
4. **Summarize findings**: Categorize as critical, important, or minor

## Output Format

### Critical Issues
Issues that will cause bugs or security vulnerabilities.

### Important
Code quality, maintainability, or performance concerns.

### Minor / Style
Formatting, naming, documentation suggestions.

### Summary
Overall assessment: approve, request changes, or needs discussion.

## Guidelines

- Focus on correctness first, style second
- Check for: null/undefined handling, error paths, type safety, hardcoded values
- Verify new dependencies are justified
- Flag any secrets, credentials, or PII in code
