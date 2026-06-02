import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';

function check(text) {
  try {
    const r = execFileSync('bun', ['scripts/humanize-check.mjs'],
      { input: text, encoding: 'utf8', timeout: 10000 });
    return JSON.parse(r);
  } catch (e) {
    return JSON.parse(e.stdout || '{}');
  }
}

test('clean prose returns ok', () => {
  const r = check('The product ships next week. Tests passed. Deployment is ready. The team reviewed the pull request.');
  expect(r.verdict).toBe('ok');
  expect(typeof r.word_count).toBe('number');
});

test('AI vocabulary triggers warn or critical', () => {
  const r = check('We leverage our synergy to empower stakeholders with holistic actionable insights.');
  expect(['warn', 'critical']).toContain(r.verdict);
  expect(r.reasons.some(s => /vocabulary/i.test(s))).toBe(true);
});

test('dense AI-tells trigger critical', () => {
  const text = [
    'It is important to note that we leverage our robust cutting-edge transformative ecosystem.',
    'Not only is this scalable but also it is a game-changing best-in-class solution.',
    'In conclusion, we utilize state-of-the-art technology to streamline our dynamic processes.',
    'It is worth noting that our holistic impactful next-generation platform is groundbreaking.',
    'At the end of the day, our innovative world-class team delivers synergy leveraging bespoke solutions.',
  ].join(' ');
  const r = check(text);
  expect(r.verdict).toBe('critical');
  expect(r.score).toBeGreaterThanOrEqual(6);
});

test('filler phrases trigger warn or critical', () => {
  const r = check('In conclusion, the project is done. That being said, we can improve. At the end of the day, results matter. Needless to say, we try hard.');
  expect(['warn', 'critical']).toContain(r.verdict);
  expect(r.reasons.some(s => /[Ff]iller/i.test(s))).toBe(true);
});

test('output has required fields', () => {
  const r = check('Hello world.');
  expect(typeof r.verdict).toBe('string');
  expect(typeof r.score).toBe('number');
  expect(Array.isArray(r.reasons)).toBe(true);
  expect(typeof r.word_count).toBe('number');
});
