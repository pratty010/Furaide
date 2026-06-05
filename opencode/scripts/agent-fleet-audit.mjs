import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = readdirSync('agents').filter(file => file.endsWith('.md')).sort();

const rows = files.map(file => {
  const body = readFileSync(join('agents', file), 'utf8');
  const mode = body.match(/^mode:\s*(.+)$/m)?.[1]?.trim() ?? 'missing';
  const model = body.match(/^model:\s*(.+)$/m)?.[1]?.trim() ?? 'missing';
  const description = body.match(/^description:\s*>?\s*(.+)$/m)?.[1]?.trim() ?? 'missing';
  const mentions = [...body.matchAll(/@([a-z0-9-]+)/g)].map(match => match[1]);
  const taskTargets = [...body.matchAll(/^\s{4}([a-z0-9-]+):\s*allow$/gm)].map(match => match[1]).filter(name => name !== '*');

  return `| ${file} | ${mode} | ${model} | ${description.replace(/\|/g, '/')} | ${mentions.join(', ')} | ${taskTargets.join(', ')} |`;
});

const report = [
  '# Agent Fleet Structural Findings',
  '',
  '## Inventory',
  '',
  '| File | Mode | Model | Description | Mentions | Task Targets |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
  '## Structural Findings',
  '',
  '- Pending manual review.',
  '',
  '## Approval Gate',
  '',
  '- Do not apply hierarchy changes until the user approves this file.',
  '',
].join('\n');

writeFileSync('docs/agent-fleet-structural-findings.md', report);
console.log(`Audit generated: ${files.length} agents`);
