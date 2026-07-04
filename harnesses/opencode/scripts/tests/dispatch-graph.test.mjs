import { test, expect } from 'bun:test';
import { analyzeGraph } from '../lint-dispatch-graph.mjs';

test('detects cycle', () => {
  const agents = {
    a: { task: { b: 'allow' }, perms: {} },
    b: { task: { a: 'allow' }, perms: {} },
  };
  expect(analyzeGraph(agents, 'a').errors.join(' ')).toContain('cycle');
});

test('flags ask reachable at depth >= 2', () => {
  const agents = {
    root: { task: { mid: 'allow' }, perms: {} },
    mid: { task: { deep: 'allow' }, perms: {} },
    deep: { task: {}, perms: { webfetch: 'ask' } },
  };
  const r = analyzeGraph(agents, 'root');
  expect(r.errors.join(' ')).toContain('ask');
});

test('flags path length > 3', () => {
  const agents = {
    r: { task: { a: 'allow' }, perms: {} },
    a: { task: { b: 'allow' }, perms: {} },
    b: { task: { c: 'allow' }, perms: {} },
    c: { task: { d: 'allow' }, perms: {} },
    d: { task: {}, perms: {} },
  };
  expect(analyzeGraph(agents, 'r').errors.join(' ')).toContain('depth');
});

test('clean DAG passes', () => {
  const agents = {
    r: { task: { a: 'allow' }, perms: {} },
    a: { task: { w: 'allow' }, perms: {} },
    w: { task: {}, perms: {} },
  };
  expect(analyzeGraph(agents, 'r').errors).toEqual([]);
});
