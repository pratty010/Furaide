import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { CONFIG_FILE } from './paths.js'

export const ConfigSchema = z.object({
  version:                  z.literal(1).default(1),
  dream_interval_hours:     z.number().positive().default(24),
  harnesses:                z.array(z.enum(['claude_code', 'codex', 'opencode'])).default(['claude_code']),
  lookback_days:            z.number().positive().default(30),
  llm_budget_per_dream:     z.number().int().nonnegative().default(50_000),
  judge_backend:            z.enum(['claude_cli', 'none']).default('claude_cli'),
  judge_model:              z.string().default('claude-haiku-4-5'),
  evidence_retention_days:  z.number().positive().default(90),
  min_sample_threshold:     z.number().int().positive().default(5),
  cc_transcripts_dir:       z.string().default('~/.claude/projects'),
  codex_sessions_dir:       z.string().default('~/.codex/sessions'),
  opencode_db:              z.string().default('~/.local/share/opencode/opencode.db'),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(overridePath?: string): Config {
  const path = overridePath ?? CONFIG_FILE
  if (!existsSync(path)) return ConfigSchema.parse({})
  return ConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
