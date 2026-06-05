#!/usr/bin/env node
// unmerge-config.mjs — Comment-tolerant opencode.json(c) config cleaner
//
// Usage:
//   node scripts/unmerge-config.mjs <config-path> [plugin-basename...] [--rules]

import { readFileSync, writeFileSync, renameSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";

const [, , cfgPath, ...rest] = process.argv;

if (!cfgPath) {
  console.error(
    "Usage: unmerge-config.mjs <config-path> [plugin-basename...] [--rules]"
  );
  process.exit(1);
}

const rulesIdx = rest.indexOf("--rules");
const hasRules = rulesIdx !== -1;
const pluginArgs = rest.filter((a) => a !== "--rules");

let raw;
try {
  raw = readFileSync(cfgPath, "utf8");
} catch (e) {
  // If config doesn't exist, we are done
  process.exit(0);
}

let stripped = raw;
try { JSON.parse(raw); } catch {
  stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*/gm, "")    // full-line // comments
    .replace(/\s+\/\/[^"'\n][^\n]*/g, ""); // trailing // comments
}

let config;
try {
  config = JSON.parse(stripped);
} catch (e) {
  console.error(`Failed to parse ${cfgPath}: ${e.message}`);
  process.exit(1);
}

let changed = false;

if (config.plugin) {
  const originalLength = config.plugin.length;
  for (const pArg of pluginArgs) {
    const rel = `./plugins/${basename(pArg)}`;
    config.plugin = config.plugin.filter(p => p !== rel);
  }
  if (config.plugin.length !== originalLength) {
    changed = true;
  }
  if (config.plugin.length === 0) {
    delete config.plugin;
    changed = true;
  }
}

if (hasRules && config.instructions) {
  const originalLength = config.instructions.length;
  const ruleGlob = "./rules/*.md";
  config.instructions = config.instructions.filter(i => i !== ruleGlob);
  if (config.instructions.length !== originalLength) {
    changed = true;
  }
  if (config.instructions.length === 0) {
    delete config.instructions;
    changed = true;
  }
}

if (!changed) {
  process.exit(0);
}

const out = JSON.stringify(config, null, 2) + "\n";
const tmpFile = join(tmpdir(), `unmerge-config-${Date.now()}.json`);
writeFileSync(tmpFile, out, "utf8");
renameSync(tmpFile, cfgPath);

console.log(`[unmerge-config] cleaned ${cfgPath}`);
