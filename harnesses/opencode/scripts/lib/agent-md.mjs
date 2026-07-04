// Shared frontmatter parser for bundled agents/*.md files.
//
// Parses the simple subset of YAML used by this repo's agent frontmatter:
// scalars, quoted/bare keys, nested maps by indentation, and ">"/"|" block
// scalars. No YAML library dependency by design.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m[1].length;
}

function parseScalar(raw) {
  raw = raw.trim();
  if (raw === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  const dq = raw.match(/^"(.*)"$/);
  if (dq) return dq[1];
  const sq = raw.match(/^'(.*)'$/);
  if (sq) return sq[1];
  return raw;
}

/**
 * Parse a block of YAML-subset lines (already split, frontmatter only) into
 * a nested plain object. `lines` is the full line array; `pos` is a mutable
 * cursor object `{ i }` so nested calls can advance the shared cursor.
 */
function parseMap(lines, pos, minIndent) {
  const obj = {};
  while (pos.i < lines.length) {
    const line = lines[pos.i];
    if (line.trim() === '') { pos.i++; continue; }
    const ind = indentOf(line);
    if (ind < minIndent) break;
    if (ind > minIndent) { pos.i++; continue; }
    const m = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^:\s][^:]*?)):\s*(.*)$/);
    if (!m) { pos.i++; continue; }
    const key = (m[1] ?? m[2] ?? m[3]).trim().replace(/^@/, '');
    const valueRaw = m[4];
    pos.i++;
    if (valueRaw === '>' || valueRaw === '|') {
      const parts = [];
      while (pos.i < lines.length) {
        const l2 = lines[pos.i];
        if (l2.trim() === '') { pos.i++; continue; }
        const ind2 = indentOf(l2);
        if (ind2 <= ind) break;
        parts.push(l2.trim());
        pos.i++;
      }
      obj[key] = valueRaw === '>' ? parts.join(' ').trim() : parts.join('\n');
    } else if (valueRaw === '') {
      let j = pos.i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && indentOf(lines[j]) > ind) {
        obj[key] = parseMap(lines, pos, indentOf(lines[j]));
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(valueRaw);
    }
  }
  return obj;
}

/** Flatten a nested permission object into dotted-key -> value pairs. */
export function flattenPermission(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v && typeof v === 'object') Object.assign(out, flattenPermission(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

/**
 * Parse a single agent markdown file's contents into
 * { name, description, mode, model, temperature, steps, permission, prompt }.
 * `name` is passed in by the caller (derived from the filename).
 */
export function parseAgentMd(source, name) {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fmLines = m[1].split('\n');
  const prompt = (m[2] ?? '').replace(/^\n+/, '');
  const pos = { i: 0 };
  const fm = parseMap(fmLines, pos, 0);
  return {
    name,
    description: fm.description,
    mode: fm.mode,
    model: fm.model,
    temperature: fm.temperature,
    steps: fm.steps,
    permission: fm.permission ?? {},
    prompt,
  };
}

/**
 * Load every agents/*.md in `dir` into a map of name -> parsed agent object
 * (full shape, per parseAgentMd), plus legacy-shaped `task`/`perms` fields
 * for backward compatibility with the dispatch-graph lint tool.
 */
export function loadAgentsFromDir(dir) {
  const agents = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const name = f.replace(/\.md$/, '');
    const parsed = parseAgentMd(src, name);
    if (!parsed) continue;
    const task = parsed.permission?.task ?? {};
    const perms = flattenPermission(parsed.permission);
    agents[name] = { ...parsed, task, perms };
  }
  return agents;
}
