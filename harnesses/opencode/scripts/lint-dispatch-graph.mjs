#!/usr/bin/env node
/**
 * Probe (d): static lint of the agent dispatch graph.
 * From the root agent, walk permission.task allow edges and assert:
 *   1. acyclic, 2. max path length 3 below root,
 *   3. no `ask`-valued permission on any agent reachable at depth >= 2.
 * CLI: bun scripts/lint-dispatch-graph.mjs [--root kantoku--workflow-director]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function analyzeGraph(agents, root) {
  const errors = [];
  const seenDepth = new Map();
  const walk = (name, depth, path) => {
    if (path.includes(name)) { errors.push(`cycle: ${[...path, name].join(' -> ')}`); return; }
    if (depth > 3) { errors.push(`depth ${depth} > 3 at ${[...path, name].join(' -> ')}`); return; }
    const agent = agents[name];
    if (!agent) return;
    if (depth >= 2) {
      for (const [perm, val] of Object.entries(flatten(agent.perms))) {
        if (val === 'ask') errors.push(`ask-valued permission "${perm}" on ${name} reachable at depth ${depth}`);
      }
    }
    if (seenDepth.get(name) <= depth) return;
    seenDepth.set(name, depth);
    for (const [target, val] of Object.entries(agent.task ?? {})) {
      if (target !== '*' && val === 'allow') walk(target, depth + 1, [...path, name]);
    }
  };
  walk(root, 0, []);
  return { errors };
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

export function loadAgentsFromDir(dir) {
  const agents = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const m = src.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const name = f.replace(/\.md$/, '');
    const task = {};
    const perms = {};
    let inPerm = false; let inTask = false;
    for (const line of m[1].split('\n')) {
      if (/^permission:\s*$/.test(line)) { inPerm = true; inTask = false; continue; }
      if (inPerm && /^  task:\s*$/.test(line)) { inTask = true; continue; }
      if (inPerm && /^  \w/.test(line)) inTask = false;
      if (!/^\s/.test(line)) { inPerm = false; inTask = false; }
      const kv = line.match(/^\s+"?([@\w*.\- /]+)"?:\s*(allow|ask|deny)\s*$/);
      if (!kv) continue;
      const key = kv[1].replace(/^@/, '');
      if (inTask) task[key] = kv[2];
      else if (inPerm) perms[key] = kv[2];
    }
    agents[name] = { task, perms };
  }
  return agents;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > -1 ? process.argv[rootArg + 1] : 'kantoku--workflow-director';
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');
  const { errors } = analyzeGraph(loadAgentsFromDir(dir), root);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('dispatch graph OK');
}
