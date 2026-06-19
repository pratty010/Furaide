#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const [, , targetPath, fragmentPath] = process.argv;

if (!targetPath || !fragmentPath) {
  console.error("Usage: unmerge-package-fragment.mjs <target-package.json> <fragment-package.json>");
  process.exit(1);
}

if (!existsSync(targetPath)) {
  process.exit(0);
}

let fragment;
try {
  fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
} catch (e) {
  console.error(`Failed to read fragment ${fragmentPath}: ${e.message}`);
  process.exit(1);
}

let target;
try {
  target = JSON.parse(readFileSync(targetPath, "utf8"));
} catch (e) {
  console.error(`Failed to parse target ${targetPath}: ${e.message}`);
  process.exit(1);
}

let changed = false;

const depSections = ["dependencies", "devDependencies", "peerDependencies"];
for (const section of depSections) {
  const fragmentDeps = fragment[section] ?? {};
  if (Object.keys(fragmentDeps).length === 0) continue;
  if (!target[section]) continue;
  for (const name of Object.keys(fragmentDeps)) {
    if (name in target[section]) {
      delete target[section][name];
      changed = true;
    }
  }
  if (Object.keys(target[section]).length === 0) {
    delete target[section];
  }
}

const out = JSON.stringify(target, null, 2) + "\n";
const tmpFile = join(tmpdir(), `unmerge-pkg-${Date.now()}-${process.pid}.json`);
writeFileSync(tmpFile, out, "utf8");
renameSync(tmpFile, targetPath);
