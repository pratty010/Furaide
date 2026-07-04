import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// Note: root README.md is deliberately NOT in this list. npm/bun pack always
// includes a root README.md regardless of the "files" allow-list (standard,
// unavoidable npm behavior) — that's fine, since Task 41 makes the
// harness-root README.md the package consumer-facing readme. The packaging
// boundary concern is repo-internal docs (docs/superpowers/, docs/imgs/,
// root AGENTS.md, etc.), which the "files" allow-list does keep out.
const FORBIDDEN_PATHS = [
  "future-work/",
  "tools/",
  "docs/superpowers/",
  "docs/imgs/",
  "scripts/dev/",
  "scripts/tests/",
  "AGENTS.md",
  "config/opencode.jsonc",
];

const FORBIDDEN_FILES = [
  ".npmignore",
];

// Packages that should appear in the packed file list
const REQUIRED_PATTERNS = [
  { pattern: "src/index.ts", desc: "entry point" },
  { pattern: "src/load-agents.ts", desc: "agent loader" },
  { pattern: "config/AGENTS.md", desc: "shipped AGENTS.md" },
];

/**
 * Verify the package boundary using the `package.json` `files` field as the
 * source of truth. This avoids running `bun pm pack`, which leaves a
 * background daemon process that causes bun test to kill sibling processes
 * with SIGTERM in subsequent test files.
 *
 * The `files` array in package.json is the declarative allow-list. We verify:
 *   1. Forbidden paths are not matched by any `files` glob.
 *   2. Required patterns are matched by at least one `files` glob.
 *   3. Actual files on disk under the matched globs don't include forbidden
 *      paths (basic sanity check — not as thorough as a real pack dry-run,
 *      but sufficient for CI to catch packaging regressions).
 */
function getPackageFilesField() {
  const pkg = JSON.parse(readFileSync(join(HARNESS_ROOT, "package.json"), "utf8"));
  return pkg.files || [];
}

/**
 * Expand a simplified glob pattern and return matching paths on disk.
 * Supports `**`, `*`, and `?` with minimal globbing.
 */
function expandGlob(pattern, baseDir) {
  const parts = pattern.split("/");
  return expandParts(parts, [baseDir]);
}

function expandParts(parts, currentPaths) {
  if (parts.length === 0) return currentPaths;
  if (currentPaths.length === 0) return [];

  const part = parts[0];
  const rest = parts.slice(1);

  if (part === "**") {
    // Match everything recursively — dirs AND files
    const allEntries = [];
    for (const p of currentPaths) {
      const walk = (entryPath) => {
        allEntries.push(entryPath);
        try {
          for (const entry of readdirSync(entryPath, { withFileTypes: true })) {
            const full = join(entryPath, entry.name);
            if (entry.isDirectory()) walk(full);
            else allEntries.push(full);
          }
        } catch {}
      };
      walk(p);
    }
    const unique = [...new Set(allEntries)];
    // If there are remaining parts, filter to only directories for further matching
    if (rest.length > 0) {
      const dirsOnly = unique.filter((p) => {
        try { return statSync(p).isDirectory(); } catch { return false; }
      });
      return expandParts(rest, dirsOnly);
    }
    return unique;
  }

  if (part.includes("*") || part.includes("?")) {
    const regex = new RegExp(
      "^" + part.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$"
    );
    const matches = [];
    for (const p of currentPaths) {
      try {
        for (const entry of readdirSync(p, { withFileTypes: true })) {
          if (regex.test(entry.name)) {
            matches.push(join(p, entry.name));
          }
        }
      } catch {}
    }
    return expandParts(rest, matches);
  }

  const exact = [];
  for (const p of currentPaths) {
    const fp = join(p, part);
    try {
      statSync(fp);
      exact.push(fp);
    } catch {}
  }
  return expandParts(rest, exact);
}

function allPackedPaths() {
  const files = getPackageFilesField();
  const result = [];
  for (const pattern of files) {
    const matches = expandGlob(pattern, HARNESS_ROOT);
    for (const m of matches) {
      const rel = m.startsWith(HARNESS_ROOT + "/")
        ? m.slice(HARNESS_ROOT.length + 1)
        : m;
      result.push(rel);
    }
  }
  return [...new Set(result)];
}

describe("package boundary", () => {
  const packed = allPackedPaths();

  test("packaged file list is non-empty", () => {
    expect(packed.length).toBeGreaterThan(0);
  });

  for (const forbidden of FORBIDDEN_PATHS) {
    test(`does not include forbidden path: ${forbidden}`, () => {
      const match = packed.find((file) =>
        file.startsWith(forbidden)
      );
      expect(match).toBeUndefined();
    });
  }

  for (const forbidden of FORBIDDEN_FILES) {
    test(`does not include forbidden file: ${forbidden}`, () => {
      expect(packed).not.toContain(forbidden);
    });
  }

  for (const { pattern, desc } of REQUIRED_PATTERNS) {
    test(`includes ${desc}: ${pattern}`, () => {
      expect(packed).toContain(pattern);
    });
  }

  test("includes exactly 15 agent definitions", () => {
    const agentFiles = packed.filter(
      (file) => file.startsWith("agents/") && file.endsWith(".md")
    );
    expect(agentFiles.length).toBe(15);
  });
});
