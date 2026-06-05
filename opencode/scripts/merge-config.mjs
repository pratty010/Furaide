#!/usr/bin/env node
// merge-config.mjs — Comment-tolerant opencode.json(c) config merger
//
// Usage:
//   bun scripts/merge-config.mjs <config-path> [plugin-basename...] [--rules]
//
// Reads a .json or .jsonc opencode config, adds missing plugin and instructions
// entries, and writes back atomically (tmp + rename). Idempotent — running twice
// produces the same result.
//
// For .jsonc files: strips line comments (// ...) before parsing, then writes
// clean JSON. The $ schema comment is preserved via a field, not inline comments.

import { readFileSync, writeFileSync, renameSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, basename } from "path";

const [, , cfgPath, ...rest] = process.argv;

if (!cfgPath) {
  console.error(
    "Usage: merge-config.mjs <config-path> [plugin-basename...] [--rules]"
  );
  process.exit(1);
}

const rulesIdx = rest.indexOf("--rules");
const hasRules = rulesIdx !== -1;
const pluginArgs = rest.filter((a) => a !== "--rules");

// ── Read and strip JSONC comments ────────────────────────────────────────────
let raw;
try {
  raw = readFileSync(cfgPath, "utf8");
} catch (e) {
  // If file doesn't exist, start with a minimal config
  raw = '{"$schema":"https://opencode.ai/config.json","plugin":[],"instructions":[]}';
}

// Try parsing as-is first (most .jsonc files in this repo are valid JSON)
// If that fails, strip line comments (only // at line start or after whitespace,
// not // inside string values like URLs).
let stripped = raw;
try { JSON.parse(raw); } catch {
  stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*/gm, "")    // full-line // comments
    .replace(/\s+\/\/[^"'\n][^\n]*/g, ""); // trailing // comments (not inside strings)
}

let config;
try {
  config = JSON.parse(stripped);
} catch (e) {
  console.error(`Failed to parse ${cfgPath}: ${e.message}`);
  process.exit(1);
}

// ── Apply modifications ───────────────────────────────────────────────────────
config.plugin ??= [];
config.instructions ??= [];

let changed = false;

for (const pArg of pluginArgs) {
  const rel = `./plugins/${basename(pArg)}`;
  if (!config.plugin.includes(rel)) {
    config.plugin.push(rel);
    changed = true;
  }
}

if (hasRules) {
  const ruleGlob = "./rules/*.md";
  if (!config.instructions.includes(ruleGlob)) {
    config.instructions.push(ruleGlob);
    changed = true;
  }
}

if (!changed) {
  process.exit(0); // already up to date, no-op
}

// ── Write atomically ──────────────────────────────────────────────────────────
const out = JSON.stringify(config, null, 2) + "\n";
const tmpFile = join(tmpdir(), `merge-config-${Date.now()}.json`);
writeFileSync(tmpFile, out, "utf8");
renameSync(tmpFile, cfgPath);

console.log(`[merge-config] updated ${cfgPath}`);
