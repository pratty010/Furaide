import { test, expect } from 'bun:test';
import { serialize, sanitizeForParent } from '../lib/history-serializer.mjs';

test('minimax: KEEP full content including think', () => {
  const turn = { content: '<think>reasoning</think>answer', tool_use: [{id:'t1'}] };
  expect(serialize('minimax', turn)).toStrictEqual(turn);
});

test('qwen: STRIP think from content', () => {
  const turn = { content: '<think>deep thought</think>final answer' };
  expect(serialize('qwen', turn).content).toBe('final answer');
});

test('glm: STRIP thinking from content', () => {
  const turn = { content: '<thinking>scratch</thinking>output' };
  expect(serialize('glm', turn).content).toBe('output');
});

test('deepseek: DROP reasoning_content', () => {
  const turn = { content: 'answer', reasoning_content: 'hidden' };
  const r = serialize('deepseek', turn);
  expect(r.content).toBe('answer');
  expect('reasoning_content' in r).toBe(false);
});

test('sanitizeForParent: strips all reasoning patterns', () => {
  const turn = {
    content: '<think>A</think><thinking>B</thinking>visible',
    reasoning_content: 'hidden',
    tool_use: [{id:'t1'}]
  };
  const r = sanitizeForParent(turn);
  expect(r.content).toBe('visible');
  expect('reasoning_content' in r).toBe(false);
  expect(r.tool_use).toBeDefined(); // preserved
});
