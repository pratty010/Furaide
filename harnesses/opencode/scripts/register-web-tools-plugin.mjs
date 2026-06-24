#!/usr/bin/env node
// register-web-tools-plugin.mjs: Add a plugin path to opencode.jsonc's "plugin" array.
// Strips `//` line comments before parsing (JSONC); re-serializes as plain JSON
// after mutation. The installer backs up the original file first.
//
// Usage: node register-web-tools-plugin.mjs <opencode.jsonc-path> <plugin-entry>
import { readFileSync, writeFileSync } from "node:fs";

const [, , targetPath, rawPluginEntry] = process.argv;

if (!targetPath || !rawPluginEntry) {
  console.error("Usage: register-web-tools-plugin.mjs <opencode.jsonc-path> <plugin-entry>");
  process.exit(1);
}

// Accept the entry either bare (./plugins/x.ts) or with surrounding
// double-quotes already applied by the caller.
const pluginEntry = (rawPluginEntry.startsWith('"') && rawPluginEntry.endsWith('"'))
  ? rawPluginEntry.slice(1, -1)
  : rawPluginEntry;

let raw;
try {
  raw = readFileSync(targetPath, "utf8");
} catch (e) {
  console.error(`Failed to read ${targetPath}: ${e.message}`);
  process.exit(1);
}

// Strip // line comments and /* block comments */ (naive: no string-aware parsing).
// Safe for the fleet's opencode.jsonc (no // in strings, no block comments in current source).
const stripped = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/([\s,])(\/\/[^\n]*)$/gm, "$1");

let parsed;
try {
  parsed = JSON.parse(stripped);
} catch (e) {
  console.error(`Failed to parse ${targetPath} as JSONC: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(parsed.plugin)) parsed.plugin = [];
const plugins = parsed.plugin;

if (plugins.includes(pluginEntry)) {
  // Idempotent: already registered, no write needed.
  process.exit(0);
}

plugins.push(pluginEntry);

try {
  writeFileSync(targetPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
} catch (e) {
  console.error(`Failed to write ${targetPath}: ${e.message}`);
  process.exit(1);
}
