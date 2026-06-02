import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('docs/routing-manifest.json', 'utf8'));
const subagentNames = Object.keys(manifest.subagents);

for (const name of subagentNames) {
  test(`agents/${name}.md model matches manifest primary`, () => {
    let content;
    try {
      content = readFileSync(`agents/${name}.md`, 'utf8');
    } catch {
      throw new Error(`agents/${name}.md does not exist`);
    }
    const match = content.match(/^model:\s*(.+)$/m);
    expect(match, `agents/${name}.md has no model: field`).not.toBeNull();
    const fileModel = match[1].trim();
    const manifestModel = manifest.subagents[name].primary;
    expect(fileModel).toBe(manifestModel);
  });
}

const specialistNames = Object.keys(manifest.specialists);
for (const name of specialistNames) {
  test(`agents/${name}.md model matches manifest primary (specialist)`, () => {
    let content;
    try {
      content = readFileSync(`agents/${name}.md`, 'utf8');
    } catch {
      throw new Error(`agents/${name}.md does not exist`);
    }
    const match = content.match(/^model:\s*(.+)$/m);
    expect(match, `agents/${name}.md has no model: field`).not.toBeNull();
    const fileModel = match[1].trim();
    const manifestModel = manifest.specialists[name].primary;
    expect(fileModel).toBe(manifestModel);
  });
}
