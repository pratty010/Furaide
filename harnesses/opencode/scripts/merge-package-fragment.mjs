#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { join, dirname } from "path";

const [, , targetPath, fragmentPath] = process.argv;
const targetDir = dirname(targetPath);

if (!targetPath || !fragmentPath) {
  console.error("Usage: merge-package-fragment.mjs <target-package.json> <fragment-package.json>");
  process.exit(1);
}

let fragment;
try {
  fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
} catch (e) {
  console.error(`Failed to read fragment ${fragmentPath}: ${e.message}`);
  process.exit(1);
}

let target = {};
if (existsSync(targetPath)) {
  try {
    target = JSON.parse(readFileSync(targetPath, "utf8"));
  } catch (e) {
    console.error(`Failed to parse target ${targetPath}: ${e.message}`);
    process.exit(1);
  }
}

let changed = false;

const depSections = ["dependencies", "devDependencies", "peerDependencies"];
for (const section of depSections) {
  const fragmentDeps = fragment[section] ?? {};
  if (Object.keys(fragmentDeps).length === 0) continue;
  target[section] ??= {};
  for (const [name, version] of Object.entries(fragmentDeps)) {
    if (!(name in target[section])) {
      target[section][name] = version;
      changed = true;
    }
  }
  if (Object.keys(target[section]).length === 0) {
    delete target[section];
  }
}

const out = JSON.stringify(target, null, 2) + "\n";
const tmpFile = join(targetDir, `.merge-pkg-${Date.now()}-${process.pid}.json`);
writeFileSync(tmpFile, out, "utf8");
renameSync(tmpFile, targetPath);

if (changed) {
  console.log("CHANGED");
}
