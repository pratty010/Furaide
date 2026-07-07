import { test, expect } from 'bun:test'
import { ConfigSchema, loadConfig } from '../src/config.js'
import { IDISU_HOME } from '../src/paths.js'
import { homedir } from 'os'
import { join } from 'path'

test('IDISU_HOME resolves to ~/.idisu', () => {
  expect(IDISU_HOME).toBe(join(homedir(), '.idisu'))
})

test('loadConfig returns defaults when no file exists', () => {
  const cfg = loadConfig('/nonexistent/config.json')
  expect(cfg.dream_interval_hours).toBe(24)
  expect(cfg.harnesses).toEqual(['claude_code'])
  expect(cfg.min_sample_threshold).toBe(5)
})

test('ConfigSchema rejects negative dream_interval_hours', () => {
  expect(() => ConfigSchema.parse({ dream_interval_hours: -1 })).toThrow()
})
