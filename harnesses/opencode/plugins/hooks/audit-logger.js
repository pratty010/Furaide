// Audit Logger — appends compact JSONL audit records for bash/task executions.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const _TEMPLATE = '__FLEET_ROOT__';
const _SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FLEET_ROOT = _TEMPLATE.startsWith('__FLEET') ? _SELF_ROOT : _TEMPLATE;
export const HOOK_EVENT = 'tool.execute.after';

const clip = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const scriptPath = (name) => join(FLEET_ROOT, `scripts/${name}`);

function activeWorkflowId(cwd = process.cwd()) {
  const file = join(cwd, '.opencode-active-workflow');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

function resolveAuditPath(cwd, workflow) {
  const raw = execFileSync('bun', [scriptPath('state-path.mjs'), '--cwd', cwd, '--workflow', workflow], { encoding: 'utf8', timeout: 5000 });
  return join(JSON.parse(raw).stateDir, 'audit.jsonl');
}

function summarizeArgs(args = {}) {
  if (typeof args === 'string') return clip(args);
  const data = typeof args === 'object' && args ? args : { value: args };
  const slim = {};
  for (const key of ['command', 'description', 'subagent_type', 'task_id', 'workdir', 'cwd']) {
    if (data[key] !== undefined) slim[key] = clip(data[key]);
  }
  if (data.prompt !== undefined) slim.prompt = `[${clip(data.prompt, 80).length} chars] ${clip(data.prompt, 80)}`;
  if (!Object.keys(slim).length) {
    for (const [key, value] of Object.entries(data).slice(0, 4)) slim[key] = clip(typeof value === 'object' ? JSON.stringify(value) : value, 80);
  }
  return JSON.stringify(slim);
}

function agentName(ctx, input, output, args) {
  return input.agent || output.agent || ctx?.agent?.name || ctx?.agent || args.subagent_type || 'unknown';
}

export function __test_hookFor(deps = {}) {
  return async function toolExecuteAfter(input = {}, output = {}) {
    if (!new Set(['bash', 'task']).has(input.tool)) return;
    const cwd = input.cwd || output.cwd || process.cwd();
    const workflow = (deps.getWorkflowId || activeWorkflowId)(cwd);
    if (!workflow) return;
    const args = output.args || input.args || {};
    const line = {
      ts: (deps.now || (() => new Date().toISOString()))(),
      agent: agentName(deps.ctx, input, output, args),
      tool: input.tool,
      'args-summary': summarizeArgs(args),
      exit: output.exitCode ?? output.exit ?? output.result?.exitCode ?? input.exitCode ?? input.exit ?? null,
    };
    const auditPath = (deps.resolveAuditPath || resolveAuditPath)(cwd, workflow);
    mkdirSync(dirname(auditPath), { recursive: true });
    (deps.appendLine || appendFileSync)(auditPath, `${JSON.stringify(line)}\n`, 'utf8');
  };
}

/** Factory returning the plugin object — used by the package export in src/index.ts */
export async function createAuditLoggerPlugin() {
  return {
    name: 'audit-logger',
    hooks: {
      [HOOK_EVENT]: __test_hookFor({}),
    },
  };
}

export const AuditLoggerPlugin = async (ctx = {}) => ({
  [HOOK_EVENT]: __test_hookFor({ ctx }),
});

export default AuditLoggerPlugin;
