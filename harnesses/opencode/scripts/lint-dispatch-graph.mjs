#!/usr/bin/env node
/**
 * Probe (d): static lint of the agent dispatch graph.
 * From the root agent, walk permission.task allow edges and assert:
 *   1. acyclic, 2. max path length 3 below root,
 *   3. no `ask`-valued permission on any agent reachable at depth >= 2.
 * CLI: bun scripts/lint-dispatch-graph.mjs [--root kantoku--workflow-director]
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentsFromDir } from './lib/agent-md.mjs';

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > -1 ? process.argv[rootArg + 1] : 'kantoku--workflow-director';
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');
  const { errors } = analyzeGraph(loadAgentsFromDir(dir), root);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('dispatch graph OK');
}
