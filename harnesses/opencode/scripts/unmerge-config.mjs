#!/usr/bin/env node
// unmerge-config.mjs — Comment-tolerant opencode.json(c) config unwirer
//
// Usage:
//   bun scripts/unmerge-config.mjs <config-path> [plugin-basename...] [--rules] [--agents-source <path>]
//
// Reads a .json or .jsonc opencode config, removes fleet-owned plugin entries,
// the rules instructions glob, and (optionally) fleet-owned agent model
// mappings based on a source fleet config, then writes back atomically.
// Idempotent — running twice on an already-clean config is a no-op.
//
// Flags:
//   --rules             Remove the "./rules/*.md" instructions entry.
//   --agents-source <path>
//                       Path to a source opencode.json(c). For each agent
//                       name present in the source's `agent` block, the
//                       corresponding key in the target is removed. Agent
//                       names NOT present in the source are preserved.
//
// For .jsonc files: strips line comments (// ...) before parsing, then writes
// clean JSON.

import { readFileSync, writeFileSync, renameSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseJsonc } from "./lib/jsonc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , cfgPath, ...rest] = process.argv;

if (!cfgPath) {
  console.error(
    "Usage: unmerge-config.mjs <config-path> [plugin-basename...] [--rules] [--agents-source <path>]"
  );
  process.exit(1);
}

const rulesIdx = rest.indexOf("--rules");
const hasRules = rulesIdx !== -1;
const agentsIdx = rest.indexOf("--agents-source");
let agentsSource = agentsIdx !== -1 ? rest[agentsIdx + 1] : null;
if (agentsIdx !== -1) {
  rest.splice(agentsIdx, 2);
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

let raw;
try {
  raw = readFileSync(cfgPath, "utf8");
} catch (e) {
  // No target config — nothing to unmerge
  process.exit(0);
}

let config;
try {
  config = parseJsonc(raw);
} catch (e) {
  console.error(`Failed to parse ${cfgPath}: ${e.message}`);
  process.exit(1);
}

let changed = false;

function normalizePluginRel(pluginArg) {
  const normalized = String(pluginArg)
    .replace(/^\.\//, "")
    .replace(/^plugins\//, "");
  return `./plugins/${normalized}`;
}

// ── Remove fleet plugins ─────────────────────────────────────────────────────
if (Array.isArray(config.plugin)) {
  const before = config.plugin.length;
  const removeSet = new Set(pluginArgs.map((a) => normalizePluginRel(a)));
  config.plugin = config.plugin.filter((p) => !removeSet.has(p));
  if (config.plugin.length !== before) changed = true;
}

// ── Remove rules glob ────────────────────────────────────────────────────────
if (hasRules && Array.isArray(config.instructions)) {
  const before = config.instructions.length;
  config.instructions = config.instructions.filter((i) => i !== "./rules/*.md");
  if (config.instructions.length !== before) changed = true;
}

// ── Remove fleet-owned agents ────────────────────────────────────────────────
if (agentsSource && config.agent && typeof config.agent === "object") {
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
  for (const agentName of Object.keys(sourceAgents)) {
    if (Object.prototype.hasOwnProperty.call(config.agent, agentName)) {
      delete config.agent[agentName];
      changed = true;
    }
  }
}

if (!changed) {
  process.exit(0);
}

const out = JSON.stringify(config, null, 2) + "\n";
const tmpFile = join(tmpdir(), `unmerge-config-${Date.now()}-${process.pid}.json`);
writeFileSync(tmpFile, out, "utf8");
renameSync(tmpFile, cfgPath);

console.log(`[unmerge-config] updated ${cfgPath}`);
