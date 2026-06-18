#!/usr/bin/env node
// merge-config.mjs — Comment-tolerant opencode.json(c) config merger
//
// Usage:
//   bun scripts/merge-config.mjs <config-path> [plugin-basename...] [--rules] [--agents-source <path>] [--agents-json <json>]
//
// Reads a .json or .jsonc opencode config, adds missing plugin and instructions
// entries, optionally merges agent model mappings from a source fleet config,
// and writes back atomically (tmp + rename). Idempotent — running twice
// produces the same result.
//
// Flags:
//   --rules             Add the "./rules/*.md" instructions glob.
//   --agents-source <path>
//                       Path to a source opencode.json(c) whose `agent` block
//                       should be merged into the target's `agent` block.
//                       Fleet-owned agent names present in the source are
//                       merged/overwritten into the target; agent names NOT
//                       present in the source are preserved on the target
//                       (i.e. user-defined agents survive).
//   --agents-json <json>
//                       Inline JSON string of resolved model map (agentName->model).
//                       Used by installer to apply resolved models without mutating repo files.
//
// For .jsonc files: strips line comments (// ...) before parsing, then writes
// clean JSON. The $schema comment is preserved via a field, not inline comments.

import { readFileSync, writeFileSync, renameSync } from "fs";
import { tmpdir } from "os";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { parseJsonc } from "./lib/jsonc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , cfgPath, ...rest] = process.argv;

if (!cfgPath) {
  console.error(
    "Usage: merge-config.mjs <config-path> [plugin-basename...] [--rules] [--agents-source <path>] [--agents-json <json>]"
  );
  process.exit(1);
}

// Parse positional + flag args
const rulesIdx = rest.indexOf("--rules");
const hasRules = rulesIdx !== -1;
const agentsIdx = rest.indexOf("--agents-source");
let agentsSource = agentsIdx !== -1 ? rest[agentsIdx + 1] : null;
if (agentsIdx !== -1) {
  rest.splice(agentsIdx, 2);
}
const agentsJsonIdx = rest.indexOf("--agents-json");
let agentsJson = agentsJsonIdx !== -1 ? rest[agentsJsonIdx + 1] : null;
if (agentsJsonIdx !== -1) {
  rest.splice(agentsJsonIdx, 2);
}
const pluginArgs = rest.filter((a) => a !== "--rules");

// --agents-source requires a real path argument. Catch three failure modes:
//   1) flag is the last arg with no value at all
//   2) flag is followed by another flag like --rules
//   3) flag is followed by an empty string
if (agentsIdx !== -1 && (agentsSource === undefined || agentsSource === null || agentsSource === "" || agentsSource.startsWith("--"))) {
  console.error("--agents-source requires a path argument");
  process.exit(1);
}

// --agents-json requires a JSON string argument
if (agentsJsonIdx !== -1 && (agentsJson === undefined || agentsJson === null || agentsJson === "" || agentsJson.startsWith("--"))) {
  console.error("--agents-json requires a JSON string argument");
  process.exit(1);
}

// ── Read and strip JSONC comments ────────────────────────────────────────────
let raw;
try {
  raw = readFileSync(cfgPath, "utf8");
} catch {
  // If file doesn't exist, start with a minimal config
  raw = '{"$schema":"https://opencode.ai/config.json","plugin":[],"instructions":[]}';
}

let config;
try {
  config = parseJsonc(raw);
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

if (agentsSource) {
  let sourceRaw;
  try {
    sourceRaw = readFileSync(agentsSource, "utf8");
  } catch (e) {
    console.error(`--agents-source: cannot read ${agentsSource}: ${e.message}`);
    process.exit(1);
  }
  let sourceCfg;
  try {
    sourceCfg = parseJsonc(sourceRaw);
  } catch (e) {
    console.error(`--agents-source: failed to parse ${agentsSource}: ${e.message}`);
    process.exit(1);
  }
  const sourceAgents = sourceCfg?.agent ?? {};
  config.agent ??= {};
  for (const [agentName, agentEntry] of Object.entries(sourceAgents)) {
    const existing = config.agent[agentName];
    const next = JSON.stringify(agentEntry);
    if (JSON.stringify(existing) !== next) {
      config.agent[agentName] = agentEntry;
      changed = true;
    }
  }
}

if (agentsJson) {
  let sourceAgents;
  try {
    const parsed = JSON.parse(agentsJson);
    sourceAgents = parsed.agent ?? parsed;
  } catch (e) {
    console.error(`--agents-json: failed to parse JSON: ${e.message}`);
    process.exit(1);
  }
  config.agent ??= {};
  for (const [agentName, agentEntry] of Object.entries(sourceAgents)) {
    const existing = config.agent[agentName];
    const next = JSON.stringify(agentEntry);
    if (JSON.stringify(existing) !== next) {
      config.agent[agentName] = agentEntry;
      changed = true;
    }
  }
}

if (!changed) {
  process.exit(0); // already up to date, no-op
}

// ── Write atomically ──────────────────────────────────────────────────────────
const out = JSON.stringify(config, null, 2) + "\n";
const tmpFile = join(tmpdir(), `merge-config-${Date.now()}-${process.pid}.json`);
writeFileSync(tmpFile, out, "utf8");
renameSync(tmpFile, cfgPath);

console.log(`[merge-config] updated ${cfgPath}`);
