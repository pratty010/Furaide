import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TARGET = 'docs/agent-fleet-structural-findings.md';

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

const inventory = [
  '# Agent Fleet Structural Findings',
  '',
  '- Review rubric: `docs/agent-description-rubric.md`',
  '',
  '## Inventory',
  '',
  '| File | Mode | Model | Description | Mentions | Task Targets |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
].join('\n');

const findingsTail = existsSync(TARGET)
  ? (() => {
      const existing = readFileSync(TARGET, 'utf8');
      const tailMatch = existing.match(/\n## Structural Findings[\s\S]*$/);
      return tailMatch ? '\n' + tailMatch[0].replace(/^\n+/, '') + (tailMatch[0].endsWith('\n') ? '' : '\n') : '';
    })()
  : '\n## Structural Findings\n\n- Pending manual review.\n\n## Approval Gate\n\n- Do not apply hierarchy changes until the user approves this file.\n';

writeFileSync(TARGET, inventory + findingsTail);
console.log(`Audit generated: ${files.length} agents`);
