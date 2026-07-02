import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
  "config/fleet-manifest.json",
];

function runPackDryRun() {
  return execSync("bun pm pack --dry-run", {
    cwd: HARNESS_ROOT,
    encoding: "utf8",
  });
}

function packedFiles(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("packed "))
    .map((line) => line.replace(/^packed\s+\S+\s+/, "").trim());
}

describe("package boundary", () => {
  const output = runPackDryRun();
  const files = packedFiles(output);

  test("pack dry-run produced a file list", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const forbidden of FORBIDDEN_PATHS) {
    test(`does not include forbidden path: ${forbidden}`, () => {
      const isRootFile = !forbidden.includes("/");
      const match = files.find((file) =>
        isRootFile ? file === forbidden : file.startsWith(forbidden)
      );
      expect(match).toBeUndefined();
    });
  }

  test("includes exactly 15 agent definitions", () => {
    const agentFiles = files.filter(
      (file) => file.startsWith("agents/") && file.endsWith(".md")
    );
    expect(agentFiles.length).toBe(15);
  });

  test("includes src entry points", () => {
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/load-agents.ts");
  });
});
