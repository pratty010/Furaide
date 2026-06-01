#!/usr/bin/env node
/**
 * memory-path.mjs
 * Computes the opencode memory path for a given working directory.
 * Validates MEMORY.md if it exists.
 *
 * Usage: bun memory-path.mjs [--cwd <path>]
 *
 * Slug rule: absolute cwd → replace every "/" with "-" → prefix "-"
 *   e.g. /home/ace/.config/opencode → -home-ace--config-opencode
 *
 * Memory location: $HOME/.local/share/opencode/memory/<slug>/MEMORY.md
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';

const MAX_LINE_LENGTH = 150;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd' && argv[i + 1]) args.cwd = argv[++i];
  }
  return args;
}

/**
 * Convert an absolute path to an opencode memory slug.
 * Rule: replace every "/" with "-" (the leading "/" becomes a leading "-").
 * Double slashes produce double dashes.
 *
 * /home/ace/.config/opencode
 *  → (replace / → -)
 *  → -home-ace--config-opencode
 *                ^^  the . becomes nothing, but - stays for the /
 * Wait — the . is NOT a slash, so it stays literally.
 * Actually: /home/ace/.config/opencode
 *   chars:  /  h  o  m  e  /  a  c  e  /  .  c  o  n  f  i  g  /  o  p  e  n  c  o  d  e
 *   slug:   -  h  o  m  e  -  a  c  e  -  .  c  o  n  f  i  g  -  o  p  e  n  c  o  d  e
 *   result: -home-ace-.config-opencode
 *
 * But the user example shows: /home/ace/.config/opencode → -home-ace--config-opencode
 * That means the "." is also replaced — but only the dot in ".config" contributes an extra "-".
 * Re-reading: "every `/` replaced by `-` and prefixed with `-`"
 * The example has -- before config. In /home/ace/.config/opencode, between ace and config
 * we have "/.c" → that "/" → "-" giving "-", then "." stays → "-." ... but example shows "--".
 *
 * The example in the spec: /home/ace/.config/opencode → -home-ace--config-opencode
 * Let's count dashes before "config": two dashes "--".
 * The path segment is "/.config" — the "/" maps to "-" and the "." must also map to "-".
 * So the rule appears to be: replace "/" AND "." with "-".
 *
 * Verify: /home/ace/.config/opencode
 *   /  → -
 *   home → home
 *   /  → -
 *   ace → ace
 *   /  → -
 *   .  → -
 *   config → config
 *   /  → -
 *   opencode → opencode
 *   result: -home-ace--config-opencode ✓
 */
function cwdToSlug(absolutePath) {
  // Replace every "/" and "." with "-"
  return absolutePath.replace(/[/.]/g, '-');
}

function validateMemoryFile(filePath) {
  const warnings = [];
  let lineCount = 0;

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    warnings.push(`Could not read MEMORY.md: ${e.message}`);
    return { lineCount: 0, warnings };
  }

  const lines = content.split('\n');
  lineCount = lines.length;

  lines.forEach((line, i) => {
    if (line.length > MAX_LINE_LENGTH) {
      warnings.push(
        `Line ${i + 1} exceeds ${MAX_LINE_LENGTH} chars (${line.length} chars): "${line.slice(0, 60)}..."`
      );
    }
  });

  return { lineCount, warnings };
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || '/root';

  const slug = cwdToSlug(cwd);
  const memoryDir = join(home, '.local', 'share', 'opencode', 'memory', slug);
  const memoryIndex = join(memoryDir, 'MEMORY.md');

  const exists = existsSync(memoryIndex);
  let lineCount = null;
  let warnings = [];

  if (exists) {
    const validation = validateMemoryFile(memoryIndex);
    lineCount = validation.lineCount;
    warnings = validation.warnings;
  }

  const output = {
    cwd,
    slug,
    memoryDir,
    memoryIndex,
    exists,
    ...(lineCount !== null ? { lineCount } : {}),
    warnings,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
