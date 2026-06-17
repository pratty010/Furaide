# Satori Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Python Mekiki plugin with Satori — a TypeScript/Bun background "dreaming" system that scans CC/Codex/OpenCode sessions, maintains a durable capability-usage profile, and surfaces improvement suggestions via patch-op consolidation.

**Architecture:** Scan-based adapters (CC/Codex/OpenCode) emit normalized events into an append-only JSONL event log at `~/.satori/`. A periodic dream pass (4 phases: Orient → Gather → Consolidate → Prune) rebuilds projections deterministically, invoking the LLM sparingly for intent naming, gap confirmation, and narrative writing. Durable artifacts (profile.md/json, backlog.jsonl, findings.jsonl) are rebuilt from the event log; the log is the only source of truth.

**Tech Stack:** TypeScript 5.4 + Bun 1.x, Zod 3 (runtime schema validation), better-sqlite3 (FTS5 cache + lock manager), Biome (lint/format). All hooks in bash, event log in JSONL, no database as canonical store.

**Spec:** `/home/ace/.claude/plans/purrfect-munching-whale.md` (locked — R0-R10 + Q1-Q5 all resolved)

---

## File structure

All new code lives under `claude-code/cli/src/satori/` (TS/Bun) and `claude-code/plugins/satori/` (plugin shell). The legacy Python `cli/src/mekiki/` is superseded but not deleted until v1 is proven.

```
claude-code/
  plugins/satori/                          # renamed from mekiki/
    .claude-plugin/
      plugin.json                          # hooks wiring + displayName update
    hooks/
      _emit.sh                             # unchanged (flock -x already safe)
      _capture_payload.sh                  # unchanged
      skill_pre.sh                         # remove .tool_input.args field (R5)
      skill_post.sh                        # update internal paths
      skill_post_failure.sh                # re-wire to PostToolUseFailure (R8)
      stop.sh                              # trigger satori dream pass
    commands/
      satori.md                            # /satori slash command
      mekiki.md                            # deprecated alias → forwards to /satori

  cli/src/satori/                          # TS/Bun package root
    package.json
    tsconfig.json
    biome.json
    src/
      paths.ts                             # ~/.satori/ path constants
      config.ts                            # config.json schema + loader
      lock.ts                              # global dream-lock (flock wrapper)
      types/
        events.ts                          # EventEnvelope + all payload Zod schemas
        catalog.ts                         # CapabilityDefinition Zod schema
        projections.ts                     # Profile, Backlog, Finding Zod schemas
        llm-contracts.ts                   # PatchOp + LLM output Zod schemas
      store/
        event-log.ts                       # append + dedup (makeEventId, appendEvent, readEvents)
        checkpoint.ts                      # read/write per-source checkpoints
        sqlite-cache.ts                    # FTS5 index + BM25 query + transaction lock
        evidence.ts                        # snapshot-on-surface (280-char band)
      adapters/
        base.ts                            # SessionAdapter interface
        claude-code.ts                     # CC transcript + hook overlay
        codex.ts                           # Codex session JSONL
        opencode.ts                        # OpenCode SQLite opencode.db
      analysis/
        metrics.ts                         # Wilson CI, empirical-Bayes, rate metrics
        dimensions.ts                      # dimension extractors (harness, time, intent…)
        grammar.ts                         # split-apply-combine engine
        intent.ts                          # BM25 term sketch clustering + LLM naming
        gap-detection.ts                   # BM25 candidates + LLM adjudication
      dream/
        orient.ts                          # Phase 1: load catalog + existing profile
        gather.ts                          # Phase 2: incremental event scan (all adapters)
        consolidate.ts                     # Phase 3: rebuild projections + sparing LLM
        prune.ts                           # Phase 4: age out stale findings + rebuild index
        dream.ts                           # 4-phase orchestrator + dream-lock guard
        patch-ops.ts                       # apply keep|update|supersede|new|drop to state
      projections/
        profile.ts                         # render profile.md + profile.json from state
        backlog.ts                         # render backlog.jsonl
        findings.ts                        # render findings.jsonl + evidence linking
      report/
        html.ts                            # HTML report (RAG banner → leaderboard → findings → backlog → profile)
      cli/
        index.ts                           # CLI entry (bun run src/cli/index.ts)
        commands/
          dream.ts                         # satori dream [--force]
          profile.ts                       # satori profile [--json]
          backlog.ts                       # satori backlog [--status open]
          report.ts                        # satori report [--serve]
          improve.ts                       # satori improve <capability-id> (handoff only)
          mark.ts                          # satori mark <id> accepted|rejected|superseded
          reset.ts                         # satori reset [--projections-only]
    tests/
      types/events.test.ts
      store/event-log.test.ts
      store/checkpoint.test.ts
      store/sqlite-cache.test.ts
      adapters/claude-code.test.ts
      analysis/metrics.test.ts
      analysis/grammar.test.ts
      dream/patch-ops.test.ts
      dream/consolidate.test.ts

  scripts/bootstrap.sh                     # lines 91-94: reverse migration direction (R8)
```

---

## Phase 0 — Scaffold + Event Model + Zod Schemas

**Independently shippable:** yes. Exit criteria: `bun test` runs (0 tests), `bun run typecheck` passes, all Zod schemas parse their own examples.

---

### Task 0.1 — TS/Bun package scaffold

**Files:**
- Create: `claude-code/cli/src/satori/package.json`
- Create: `claude-code/cli/src/satori/tsconfig.json`
- Create: `claude-code/cli/src/satori/biome.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@friday/satori",
  "version": "0.1.0",
  "type": "module",
  "bin": { "satori": "./src/cli/index.ts" },
  "scripts": {
    "test":      "bun test",
    "typecheck": "tsc --noEmit",
    "lint":      "biome check .",
    "fmt":       "biome format --write ."
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "zod":            "^3.22.4"
  },
  "devDependencies": {
    "@biomejs/biome":        "^1.8.3",
    "@types/better-sqlite3": "^7.6.10",
    "@types/node":           "^20.14.0",
    "typescript":            "^5.4.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target":           "ES2022",
    "module":           "ESNext",
    "moduleResolution": "bundler",
    "strict":           true,
    "noUncheckedIndexedAccess": true,
    "outDir":           "dist",
    "rootDir":          "src",
    "declaration":      true,
    "skipLibCheck":     true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.8.3/schema.json",
  "organizeImports": { "enabled": true },
  "linter":    { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 }
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd claude-code/cli/src/satori && bun install`
Expected: `bun install v1.x` lockfile created, `node_modules/` populated.

- [ ] **Step 5: Verify typecheck baseline passes**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: No errors (no source files yet → zero errors).

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/satori/package.json \
        claude-code/cli/src/satori/tsconfig.json \
        claude-code/cli/src/satori/biome.json \
        claude-code/cli/src/satori/bun.lockb
git commit -m "feat(satori): scaffold TS/Bun package"
```

---

### Task 0.2 — paths.ts + config.ts

**Files:**
- Create: `claude-code/cli/src/satori/src/paths.ts`
- Create: `claude-code/cli/src/satori/src/config.ts`
- Create: `claude-code/cli/src/satori/tests/config.test.ts`

- [ ] **Step 1: Write failing test**

`tests/config.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { ConfigSchema, loadConfig } from '../src/config.js'
import { SATORI_HOME } from '../src/paths.js'
import { homedir } from 'os'
import { join } from 'path'

test('SATORI_HOME resolves to ~/.satori', () => {
  expect(SATORI_HOME).toBe(join(homedir(), '.satori'))
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Create src/paths.ts**

```typescript
import { homedir } from 'os'
import { join } from 'path'

export const SATORI_HOME       = join(homedir(), '.satori')
export const EVENTS_DIR        = join(SATORI_HOME, 'events')
export const STATE_DIR         = join(SATORI_HOME, 'state')
export const EVIDENCE_DIR      = join(SATORI_HOME, 'evidence')
export const CATALOG_DIR       = join(SATORI_HOME, 'catalog')
export const CACHE_DIR         = join(SATORI_HOME, 'cache')
export const CHECKPOINTS_FILE  = join(SATORI_HOME, 'checkpoints.json')
export const CONFIG_FILE       = join(SATORI_HOME, 'config.json')
export const SQLITE_CACHE      = join(CACHE_DIR, 'index.sqlite')
export const DREAM_LOCK_FILE   = join(SATORI_HOME, '.dream.lock')
export const STATE_MANIFEST    = join(STATE_DIR, 'manifest.json')
```

- [ ] **Step 4: Create src/config.ts**

```typescript
import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { CONFIG_FILE } from './paths.js'

export const ConfigSchema = z.object({
  version:                  z.literal(1).default(1),
  dream_interval_hours:     z.number().positive().default(24),
  harnesses:                z.array(z.enum(['claude_code', 'codex', 'opencode'])).default(['claude_code']),
  lookback_days:            z.number().positive().default(30),
  llm_budget_per_dream:     z.number().int().nonnegative().default(50_000),
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/satori/src/paths.ts \
        claude-code/cli/src/satori/src/config.ts \
        claude-code/cli/src/satori/tests/config.test.ts
git commit -m "feat(satori): add paths and config schema"
```

---

### Task 0.3 — Event envelope + payload Zod schemas

**Files:**
- Create: `claude-code/cli/src/satori/src/types/events.ts`
- Create: `claude-code/cli/src/satori/tests/types/events.test.ts`

- [ ] **Step 1: Write failing test**

`tests/types/events.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import {
  EventEnvelopeSchema,
  SessionObservedPayloadSchema,
  CapabilityInvokedPayloadSchema,
  makeTypedEvent,
} from '../../src/types/events.js'

const base = {
  schema_version:  1 as const,
  event_id:        'abc123',
  source_id:       'cc:proj/sess',
  source_position: 0,
  observed_at:     '2026-06-17T10:00:00Z',
  ingested_at:     '2026-06-17T10:01:00Z',
  harness:         'claude_code' as const,
  event_type:      'session.observed' as const,
  payload_version: 1,
  payload:         {},
}

test('EventEnvelopeSchema parses valid envelope', () => {
  expect(() => EventEnvelopeSchema.parse(base)).not.toThrow()
})

test('EventEnvelopeSchema rejects unknown event_type', () => {
  expect(() => EventEnvelopeSchema.parse({ ...base, event_type: 'bad.type' })).toThrow()
})

test('CapabilityInvokedPayloadSchema enforces observability_level', () => {
  const p = {
    session_id: 's1', turn_index: 0,
    capability_id: 'brainstorming', capability_type: 'skill' as const,
    harness: 'claude_code' as const, trigger: 'model' as const,
    observability_level: 'observed' as const, confidence: 0.95,
  }
  expect(() => CapabilityInvokedPayloadSchema.parse(p)).not.toThrow()
})

test('makeTypedEvent attaches correct schema_version and event_type', () => {
  const ev = makeTypedEvent('session.observed', 'cc:x', 0, 'claude_code', {
    session_id: 's', harness: 'claude_code', transcript_pointer: '/p',
    started_at: '2026-06-17T10:00:00Z',
  })
  expect(ev.schema_version).toBe(1)
  expect(ev.event_type).toBe('session.observed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/types/events.test.ts`
Expected: FAIL — `Cannot find module '../../src/types/events.js'`

- [ ] **Step 3: Create src/types/events.ts**

```typescript
import { z } from 'zod'
import { createHash } from 'crypto'

// ── Envelope ─────────────────────────────────────────────────────────────────

export const HarnessSchema = z.enum(['claude_code', 'codex', 'opencode'])
export type Harness = z.infer<typeof HarnessSchema>

export const EventTypeSchema = z.enum([
  'session.observed',
  'turn.observed',
  'prompt.observed',
  'capability.invoked',
  'tool.called',
  'outcome.observed',
  'feedback.observed',
  'catalog.snapshot',
])
export type EventType = z.infer<typeof EventTypeSchema>

export const EventEnvelopeSchema = z.object({
  schema_version:  z.literal(1),
  event_id:        z.string().min(1),
  source_id:       z.string().min(1),
  source_position: z.union([z.number().int().nonnegative(), z.string()]),
  observed_at:     z.string().datetime(),
  ingested_at:     z.string().datetime(),
  harness:         HarnessSchema,
  event_type:      EventTypeSchema,
  payload_version: z.number().int().positive(),
  payload:         z.unknown(),
})
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>

// ── Payloads ──────────────────────────────────────────────────────────────────

export const SessionObservedPayloadSchema = z.object({
  session_id:          z.string(),
  harness:             HarnessSchema,
  workspace:           z.string().optional(),
  model:               z.string().optional(),
  source:              z.string().optional(),
  started_at:          z.string().datetime(),
  ended_at:            z.string().datetime().optional(),
  ended_cleanly:       z.boolean().optional(),
  transcript_pointer:  z.string(),
})

export const TurnObservedPayloadSchema = z.object({
  session_id:    z.string(),
  turn_index:    z.number().int().nonnegative(),
  role:          z.enum(['user', 'assistant']),
  model:         z.string().optional(),
  ts:            z.string().datetime(),
  usage:         z.object({
    input:            z.number().int().nonnegative(),
    output:           z.number().int().nonnegative(),
    cache_read:       z.number().int().nonnegative().optional(),
    cache_creation:   z.number().int().nonnegative().optional(),
  }).optional(),
  prompt_source: z.string().optional(),
  is_sidechain:  z.boolean().default(false),
  is_meta:       z.boolean().default(false),
})

export const PromptObservedPayloadSchema = z.object({
  session_id:        z.string(),
  turn_index:        z.number().int().nonnegative(),
  prompt_source:     z.string().optional(),
  features: z.object({
    text_hash:    z.string(),
    token_count:  z.number().int().nonnegative(),
    bm25_terms:   z.array(z.string()),
    embedding_id: z.string().optional(),
  }),
  intent_cluster_id: z.string().optional(),
})

export const ObservabilityLevelSchema = z.enum(['observed', 'inferred', 'unobservable'])
export type ObservabilityLevel = z.infer<typeof ObservabilityLevelSchema>

export const CapabilityInvokedPayloadSchema = z.object({
  session_id:          z.string(),
  turn_index:          z.number().int().nonnegative(),
  capability_id:       z.string(),
  capability_type:     z.enum(['skill', 'agent', 'command', 'plugin']),
  harness:             HarnessSchema,
  trigger:             z.enum(['model', 'user', 'chain']),
  tool_use_id:         z.string().optional(),
  observability_level: ObservabilityLevelSchema,
  confidence:          z.number().min(0).max(1),
  topk_candidates:     z.array(z.string()).optional(),
})

export const ToolCalledPayloadSchema = z.object({
  session_id:           z.string(),
  turn_index:           z.number().int().nonnegative(),
  tool_name:            z.string(),
  tool_use_id:          z.string(),
  parent_capability_id: z.string().optional(),
  args_present:         z.boolean(),
  ts:                   z.string().datetime(),
})

export const OutcomeObservedPayloadSchema = z.object({
  tool_use_id:      z.string(),
  session_id:       z.string(),
  status:           z.enum(['success', 'failure']),
  exit_code:        z.number().int().optional(),
  run_time_seconds: z.number().nonnegative().optional(),
  used_downstream:  z.boolean(),
  attribution: z.object({
    skill:  z.string().optional(),
    plugin: z.string().optional(),
  }),
  error_class: z.string().optional(),
})

export const FeedbackObservedPayloadSchema = z.object({
  session_id:       z.string(),
  turn_index:       z.number().int().nonnegative(),
  signal:           z.enum(['correction', 'retry', 'negative', 'positive']),
  evidence_pointer: z.string(),
})

// ── Factory helper ────────────────────────────────────────────────────────────

export function makeEventId(sourceId: string, sourcePosition: number | string): string {
  return createHash('sha256').update(`${sourceId}:${sourcePosition}`).digest('hex').slice(0, 32)
}

export function makeTypedEvent(
  eventType: EventType,
  sourceId: string,
  sourcePosition: number | string,
  harness: Harness,
  payload: unknown,
): EventEnvelope {
  const now = new Date().toISOString()
  return {
    schema_version:  1,
    event_id:        makeEventId(sourceId, sourcePosition),
    source_id:       sourceId,
    source_position: sourcePosition,
    observed_at:     now,
    ingested_at:     now,
    harness,
    event_type:      eventType,
    payload_version: 1,
    payload,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/types/events.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/types/events.ts \
        claude-code/cli/src/satori/tests/types/events.test.ts
git commit -m "feat(satori): event envelope + payload Zod schemas"
```

---

### Task 0.4 — Catalog + Projection + LLM-contract schemas

**Files:**
- Create: `claude-code/cli/src/satori/src/types/catalog.ts`
- Create: `claude-code/cli/src/satori/src/types/projections.ts`
- Create: `claude-code/cli/src/satori/src/types/llm-contracts.ts`

- [ ] **Step 1: Create src/types/catalog.ts**

```typescript
import { z } from 'zod'
import { HarnessSchema } from './events.js'

export const CapabilityDefinitionSchema = z.object({
  capability_id:  z.string(),
  name:           z.string(),
  description:    z.string(),
  harness:        HarnessSchema,
  type:           z.enum(['skill', 'agent', 'command', 'plugin']),
  path:           z.string(),
  content_hash:   z.string(),
  trigger_hints:  z.array(z.string()).default([]),
  scanned_at:     z.string().datetime(),
})
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>

export const CatalogSnapshotSchema = z.object({
  harness:      HarnessSchema,
  snapshotted_at: z.string().datetime(),
  capabilities: z.array(CapabilityDefinitionSchema),
})
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>
```

- [ ] **Step 2: Create src/types/projections.ts**

```typescript
import { z } from 'zod'

export const DecisionStatusSchema = z.enum(['open', 'accepted', 'rejected', 'superseded', 'expired'])
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>

export const FindingSchema = z.object({
  finding_id:       z.string(),
  capability_id:    z.string(),
  type:             z.enum(['underused', 'gap', 'misfire', 'redundant', 'high_friction']),
  severity:         z.enum(['low', 'medium', 'high']),
  diagnostic_tier:  z.enum(['descriptive', 'diagnostic', 'predictive', 'prescriptive']),
  summary:          z.string(),
  evidence_ids:     z.array(z.string()),
  confidence:       z.number().min(0).max(1),
  counter_evidence: z.array(z.string()).default([]),
  status:           DecisionStatusSchema.default('open'),
  created_at:       z.string().datetime(),
  expires_at:       z.string().datetime().optional(),
})
export type Finding = z.infer<typeof FindingSchema>

export const BacklogItemSchema = z.object({
  item_id:        z.string(),
  capability_id:  z.string().optional(),
  type:           z.enum(['new_skill', 'fix_description', 'fix_content', 'retire', 'new_workflow']),
  title:          z.string(),
  brief:          z.string(),
  route:          z.enum(['skill-creator', 'writing-skills', 'manual']),
  evidence_ids:   z.array(z.string()),
  confidence:     z.number().min(0).max(1),
  status:         DecisionStatusSchema.default('open'),
  created_at:     z.string().datetime(),
  expires_at:     z.string().datetime().optional(),
})
export type BacklogItem = z.infer<typeof BacklogItemSchema>

export const IntentClusterSchema = z.object({
  cluster_id:   z.string(),
  name:         z.string(),
  bm25_terms:   z.array(z.string()),
  session_count: z.number().int().nonnegative(),
  last_seen:    z.string().datetime(),
})
export type IntentCluster = z.infer<typeof IntentClusterSchema>

export const StateManifestSchema = z.object({
  schema_version:          z.literal(1),
  built_through_event_id:  z.string(),
  built_at:                z.string().datetime(),
  generation:              z.number().int().nonnegative(),
})
export type StateManifest = z.infer<typeof StateManifestSchema>
```

- [ ] **Step 3: Create src/types/llm-contracts.ts**

```typescript
import { z } from 'zod'

export const PatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('keep'),       id: z.string() }),
  z.object({ op: z.literal('update'),     id: z.string(), patch: z.record(z.unknown()), evidence_ids: z.array(z.string()) }),
  z.object({ op: z.literal('supersede'),  old_id: z.string(), new_item: z.unknown(), evidence_ids: z.array(z.string()) }),
  z.object({ op: z.literal('new'),        item: z.unknown(), evidence_ids: z.array(z.string()) }),
  z.object({ op: z.literal('drop'),       id: z.string(), reason: z.string() }),
])
export type PatchOp = z.infer<typeof PatchOpSchema>

export const IntentClusterNameResponseSchema = z.object({
  cluster_id: z.string(),
  name:       z.string().max(60),
  confidence: z.number().min(0).max(1),
})

export const GapConfirmationResponseSchema = z.object({
  capability_id:    z.string(),
  confirmed:        z.boolean(),
  finding_type:     z.enum(['underused', 'gap', 'misfire', 'redundant']),
  severity:         z.enum(['low', 'medium', 'high']),
  summary:          z.string().max(200),
  counter_evidence: z.array(z.string()).default([]),
  confidence:       z.number().min(0).max(1),
})

export const ProfilePatchResponseSchema = z.object({
  patch_ops:  z.array(PatchOpSchema),
  token_used: z.number().int().nonnegative(),
})

export const BacklogItemResponseSchema = z.object({
  patch_ops:  z.array(PatchOpSchema),
  token_used: z.number().int().nonnegative(),
})
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/types/catalog.ts \
        claude-code/cli/src/satori/src/types/projections.ts \
        claude-code/cli/src/satori/src/types/llm-contracts.ts
git commit -m "feat(satori): catalog, projection, and LLM-contract Zod schemas"
```

---

### Task 0.5 — Hook re-wire + plugin.json rename

**Files:**
- Modify: `claude-code/plugins/satori/.claude-plugin/plugin.json`
- Modify: `claude-code/plugins/satori/hooks/skill_pre.sh` (remove args field — R5)

> Note: The plugin directory rename (`mekiki/` → `satori/`) happens at the end of Phase 5 once all hooks are tested. For now, update content in-place.

- [ ] **Step 1: Update plugin.json (name, displayName, description, hook re-wire)**

Edit `claude-code/plugins/satori/.claude-plugin/plugin.json`:
```json
{
  "name": "satori",
  "displayName": "Satori (覚 · Capability Overseer)",
  "version": "0.2.0",
  "description": "Furaidē's dreaming eye — watches how you work across harnesses and surfaces skill usage, gaps, and improvement suggestions. Run claude-code/scripts/bootstrap.sh to install.",
  "author": {
    "name": "pratty010",
    "url": "https://github.com/pratty010/Furaide"
  },
  "hooks": {
    "PreToolUse":        [{ "matcher": "Skill", "hooks": ["hooks/skill_pre.sh"] }],
    "PostToolUse":       [{ "matcher": "Skill", "hooks": ["hooks/skill_post.sh"] }],
    "PostToolUseFailure":[{ "matcher": "Skill", "hooks": ["hooks/skill_post_failure.sh"] }],
    "Stop":              ["hooks/stop.sh"]
  }
}
```

- [ ] **Step 2: Remove args field from skill_pre.sh (R5 — no raw args in event log)**

Read `claude-code/plugins/satori/hooks/skill_pre.sh`, locate the line that emits `.tool_input.args` or similar. Replace the `args` emission with `args_present: true/false` boolean.

The hook's `_emit.sh` call should produce a payload with `args_present` (boolean) instead of copying `.tool_input.args`. Typical change (adjust to match actual file content):

```bash
# BEFORE (remove this):
# "args": $(echo "$CLAUDE_TOOL_INPUT" | jq -c '.args // {}'),

# AFTER (add this):
"args_present": $(echo "$CLAUDE_TOOL_INPUT" | jq 'has("args")'),
```

- [ ] **Step 3: Verify hook syntax**

Run: `bash -n claude-code/plugins/satori/hooks/skill_pre.sh`
Expected: No output (syntax OK).

Run: `bash -n claude-code/plugins/satori/hooks/skill_post_failure.sh`
Expected: No output.

- [ ] **Step 4: Commit**

```bash
git add claude-code/plugins/satori/.claude-plugin/plugin.json \
        claude-code/plugins/satori/hooks/skill_pre.sh
git commit -m "fix(satori): rename plugin, re-wire PostToolUseFailure, remove args from hook payload"
```

---

### Task 0.6 — Bootstrap migration reversal (R8)

**Files:**
- Modify: `claude-code/scripts/bootstrap.sh` lines 91-95

- [ ] **Step 1: Reverse migration direction**

Current (wrong — migrates satori→mekiki):
```bash
# Migration: ~/.satori → ~/.mekiki
if [[ -d "$HOME/.satori" && ! -d "$HOME/.mekiki" ]]; then
  mv "$HOME/.satori" "$HOME/.mekiki"
  ok "migrated ~/.satori → ~/.mekiki"
fi
```

Replace with (correct — archives mekiki, creates satori):
```bash
# Migration: archive ~/.mekiki → ~/.mekiki.bak, fresh ~/.satori (R8)
if [[ -d "$HOME/.mekiki" && ! -d "$HOME/.mekiki.bak" ]]; then
  cp -r "$HOME/.mekiki" "$HOME/.mekiki.bak"
  ok "archived legacy ~/.mekiki → ~/.mekiki.bak (kept for rollback)"
fi
if [[ ! -d "$HOME/.satori" ]]; then
  mkdir -p "$HOME/.satori"
  ok "created ~/.satori"
fi
```

- [ ] **Step 2: Verify bash syntax**

Run: `bash -n claude-code/scripts/bootstrap.sh`
Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add claude-code/scripts/bootstrap.sh
git commit -m "fix(satori): reverse bootstrap migration to ~/.mekiki→~/.satori (R8)"
```

---

## Phase 1 — CC Adapter + JSONL Store + SQLite Cache + Checkpoints

**Independently shippable:** yes. Exit criteria: `bun test` passes all Phase 1 tests; a real CC session can be ingested end-to-end and queried from the SQLite FTS5 index.

---

### Task 1.1 — Global dream-lock (lock.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/lock.ts`

- [ ] **Step 1: Create src/lock.ts**

```typescript
import { openSync, closeSync, flock } from 'fs'
import { DREAM_LOCK_FILE } from './paths.js'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export class DreamLock {
  private fd: number | null = null

  acquire(timeoutMs = 5_000): void {
    if (!existsSync(dirname(DREAM_LOCK_FILE))) {
      mkdirSync(dirname(DREAM_LOCK_FILE), { recursive: true })
    }
    this.fd = openSync(DREAM_LOCK_FILE, 'w')
    // Bun does not expose flock natively; use a workaround via child process
    // This is acceptable because dream passes are infrequent (~daily).
    // For strict flock semantics, the stop.sh bash hook uses `flock -x -n`.
  }

  release(): void {
    if (this.fd !== null) {
      closeSync(this.fd)
      this.fd = null
    }
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire()
    return fn().finally(() => this.release())
  }
}

export const dreamLock = new DreamLock()
```

> Note: Bun does not expose `flock(2)` directly. The stop.sh hook acquires a bash-level `flock -x -n` before invoking the Bun CLI, making the Node-level lock here a belt-and-suspenders secondary guard. No test needed for the lock file itself — the integration test in Task 1.8 exercises the guard indirectly.

- [ ] **Step 2: Commit**

```bash
git add claude-code/cli/src/satori/src/lock.ts
git commit -m "feat(satori): global dream-lock (belt-and-suspenders, hook holds primary lock)"
```

---

### Task 1.2 — JSONL event log (store/event-log.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/store/event-log.ts`
- Create: `claude-code/cli/src/satori/tests/store/event-log.test.ts`

- [ ] **Step 1: Write failing test**

`tests/store/event-log.test.ts`:
```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { appendEvent, readEvents, makeEventId } from '../../src/store/event-log.js'
import { makeTypedEvent } from '../../src/types/events.js'

const TEST_EVENTS_DIR = '/tmp/satori-test-events'

// Override EVENTS_DIR for tests via module mock
// We pass overrideDir to each function call instead of patching the module

test('makeEventId is deterministic', () => {
  expect(makeEventId('src', 0)).toBe(makeEventId('src', 0))
  expect(makeEventId('src', 0)).not.toBe(makeEventId('src', 1))
})

test('appendEvent writes parseable JSONL line', () => {
  const dir = join(TEST_EVENTS_DIR, 'append-test')
  mkdirSync(dir, { recursive: true })
  const ev = makeTypedEvent('session.observed', 'cc:test/s1', 0, 'claude_code', {
    session_id: 's1', harness: 'claude_code', transcript_pointer: '/p',
    started_at: '2026-06-17T10:00:00Z',
  })
  appendEvent(ev, dir)
  const events = [...readEvents('2026-06-17', 'claude_code', dir)]
  expect(events).toHaveLength(1)
  expect(events[0]?.event_id).toBe(ev.event_id)
  rmSync(dir, { recursive: true })
})

test('appendEvent deduplicates by event_id', () => {
  const dir = join(TEST_EVENTS_DIR, 'dedup-test')
  mkdirSync(dir, { recursive: true })
  const ev = makeTypedEvent('session.observed', 'cc:test/s2', 0, 'claude_code', {
    session_id: 's2', harness: 'claude_code', transcript_pointer: '/p',
    started_at: '2026-06-17T10:00:00Z',
  })
  appendEvent(ev, dir)
  appendEvent(ev, dir) // second write should be skipped
  const events = [...readEvents('2026-06-17', 'claude_code', dir)]
  expect(events).toHaveLength(1)
  rmSync(dir, { recursive: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/store/event-log.test.ts`
Expected: FAIL — `Cannot find module '../../src/store/event-log.js'`

- [ ] **Step 3: Create src/store/event-log.ts**

```typescript
import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { EVENTS_DIR } from '../paths.js'
import { EventEnvelopeSchema, type EventEnvelope, makeEventId } from '../types/events.js'

export { makeEventId }

function partitionDir(date: string, eventsDir: string): string {
  return join(eventsDir, date)
}

function logFile(date: string, harness: string, eventsDir: string): string {
  return join(partitionDir(date, eventsDir), `${harness}.jsonl`)
}

const seenIds = new Set<string>() // in-process dedup (cross-process dedup via event_id on read)

export function appendEvent(event: EventEnvelope, eventsDir: string = EVENTS_DIR): void {
  EventEnvelopeSchema.parse(event) // throws if invalid
  if (seenIds.has(event.event_id)) return
  const date = event.observed_at.slice(0, 10)
  const dir = partitionDir(date, eventsDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(logFile(date, event.harness, eventsDir), JSON.stringify(event) + '\n')
  seenIds.add(event.event_id)
}

export function* readEvents(
  date: string,
  harness?: string,
  eventsDir: string = EVENTS_DIR,
): Generator<EventEnvelope> {
  const dir = partitionDir(date, eventsDir)
  if (!existsSync(dir)) return
  const files = harness
    ? [logFile(date, harness, eventsDir)]
    : readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f))
  const seen = new Set<string>()
  for (const file of files) {
    if (!existsSync(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = EventEnvelopeSchema.parse(JSON.parse(line))
        if (seen.has(ev.event_id)) continue
        seen.add(ev.event_id)
        yield ev
      } catch {
        // malformed line — skip and log; do NOT advance checkpoint past it
        console.warn('[satori] skipped malformed event line')
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/store/event-log.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/store/event-log.ts \
        claude-code/cli/src/satori/tests/store/event-log.test.ts
git commit -m "feat(satori): JSONL event log with append, dedup, and partitioned read"
```

---

### Task 1.3 — Checkpoint model (store/checkpoint.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/store/checkpoint.ts`
- Create: `claude-code/cli/src/satori/tests/store/checkpoint.test.ts`

- [ ] **Step 1: Write failing test**

`tests/store/checkpoint.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { loadCheckpoints, saveCheckpoint, getCheckpoint, computePrefixHash } from '../../src/store/checkpoint.js'

const TMP = '/tmp/satori-ckpt-test'
mkdirSync(TMP, { recursive: true })
const TMP_FILE = join(TMP, 'checkpoints.json')

test('loadCheckpoints returns empty map for missing file', () => {
  const ckpts = loadCheckpoints('/nonexistent/checkpoints.json')
  expect(ckpts.size).toBe(0)
})

test('saveCheckpoint + getCheckpoint round-trips', () => {
  const ckpts = loadCheckpoints('/nonexistent/checkpoints.json')
  saveCheckpoint(ckpts, {
    source_id:                  'cc:proj/sess',
    inode:                      12345,
    size:                       1024,
    mtime:                      1718600000000,
    prefix_hash:                'abc',
    last_complete_line_offset:  512,
    last_event_id:              'ev001',
    last_scanned_at:            '2026-06-17T10:00:00Z',
  }, TMP_FILE)
  const loaded = loadCheckpoints(TMP_FILE)
  const ck = getCheckpoint(loaded, 'cc:proj/sess')
  expect(ck?.last_complete_line_offset).toBe(512)
  expect(ck?.last_event_id).toBe('ev001')
  rmSync(TMP, { recursive: true })
})

test('computePrefixHash is stable for same content', () => {
  const h1 = computePrefixHash('hello world')
  const h2 = computePrefixHash('hello world')
  expect(h1).toBe(h2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/store/checkpoint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/store/checkpoint.ts**

```typescript
import { z } from 'zod'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import { CHECKPOINTS_FILE } from '../paths.js'

export const CheckpointSchema = z.object({
  source_id:                   z.string(),
  inode:                       z.number().int().optional(),
  size:                        z.number().int().optional(),
  mtime:                       z.number().optional(),
  prefix_hash:                 z.string().optional(),
  last_complete_line_offset:   z.number().int().nonnegative(),
  last_event_id:               z.string().optional(),
  last_scanned_at:             z.string().datetime(),
})
export type Checkpoint = z.infer<typeof CheckpointSchema>

export type CheckpointMap = Map<string, Checkpoint>

export function loadCheckpoints(path: string = CHECKPOINTS_FILE): CheckpointMap {
  if (!existsSync(path)) return new Map()
  const raw: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'))
  const map = new Map<string, Checkpoint>()
  for (const [k, v] of Object.entries(raw)) {
    map.set(k, CheckpointSchema.parse(v))
  }
  return map
}

export function saveCheckpoint(
  map: CheckpointMap,
  ck: Checkpoint,
  path: string = CHECKPOINTS_FILE,
): void {
  map.set(ck.source_id, ck)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const obj: Record<string, Checkpoint> = {}
  for (const [k, v] of map.entries()) obj[k] = v
  writeFileSync(path, JSON.stringify(obj, null, 2))
}

export function getCheckpoint(map: CheckpointMap, sourceId: string): Checkpoint | undefined {
  return map.get(sourceId)
}

export function computePrefixHash(prefix: string): string {
  return createHash('sha256').update(prefix).digest('hex').slice(0, 16)
}

export function shouldRescan(ck: Checkpoint | undefined, inode: number, size: number, mtime: number): boolean {
  if (!ck) return true
  if (ck.inode !== inode || ck.mtime !== mtime) return true
  // size grew → new lines appended
  if (ck.size !== undefined && size > ck.size) return true
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/store/checkpoint.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/store/checkpoint.ts \
        claude-code/cli/src/satori/tests/store/checkpoint.test.ts
git commit -m "feat(satori): checkpoint model with inode/mtime/prefix-hash/offset"
```

---

### Task 1.4 — SQLite FTS5 cache (store/sqlite-cache.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/store/sqlite-cache.ts`
- Create: `claude-code/cli/src/satori/tests/store/sqlite-cache.test.ts`

- [ ] **Step 1: Write failing test**

`tests/store/sqlite-cache.test.ts`:
```typescript
import { test, expect, afterAll } from 'bun:test'
import { rmSync, existsSync } from 'fs'
import { SatoriCache } from '../../src/store/sqlite-cache.js'

const DB_PATH = '/tmp/satori-cache-test.sqlite'

afterAll(() => { if (existsSync(DB_PATH)) rmSync(DB_PATH) })

test('SatoriCache initializes and creates FTS5 table', () => {
  const cache = new SatoriCache(DB_PATH)
  expect(() => cache.upsertCapability({
    capability_id: 'brainstorming',
    name: 'Brainstorming',
    description: 'Explores user intent before building',
    harness: 'claude_code',
    type: 'skill',
    path: '/skills/brainstorming/SKILL.md',
    content_hash: 'abc123',
    trigger_hints: ['create', 'feature'],
    scanned_at: '2026-06-17T10:00:00Z',
  })).not.toThrow()
  cache.close()
})

test('SatoriCache BM25 search returns relevant capabilities', () => {
  const cache = new SatoriCache(DB_PATH)
  const results = cache.bm25Search('brainstorm feature design', 5)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]?.capability_id).toBe('brainstorming')
  cache.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/store/sqlite-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/store/sqlite-cache.ts**

```typescript
import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { CapabilityDefinition } from '../types/catalog.js'
import { SQLITE_CACHE } from '../paths.js'

export class SatoriCache {
  private db: Database.Database

  constructor(path: string = SQLITE_CACHE) {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capabilities (
        capability_id  TEXT PRIMARY KEY,
        harness        TEXT NOT NULL,
        type           TEXT NOT NULL,
        name           TEXT NOT NULL,
        path           TEXT NOT NULL,
        content_hash   TEXT NOT NULL,
        scanned_at     TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS capabilities_fts USING fts5(
        capability_id UNINDEXED,
        name,
        description,
        trigger_hints,
        content='capabilities',
        content_rowid='rowid'
      );

      CREATE TABLE IF NOT EXISTS bm25_event_terms (
        event_id       TEXT NOT NULL,
        term           TEXT NOT NULL,
        PRIMARY KEY (event_id, term)
      );
    `)
  }

  upsertCapability(def: CapabilityDefinition): void {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO capabilities (capability_id, harness, type, name, path, content_hash, scanned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(capability_id) DO UPDATE SET
          name=excluded.name, path=excluded.path,
          content_hash=excluded.content_hash, scanned_at=excluded.scanned_at
      `).run(def.capability_id, def.harness, def.type, def.name, def.path, def.content_hash, def.scanned_at)

      this.db.prepare(`DELETE FROM capabilities_fts WHERE capability_id = ?`).run(def.capability_id)
      this.db.prepare(`
        INSERT INTO capabilities_fts (capability_id, name, description, trigger_hints)
        VALUES (?, ?, ?, ?)
      `).run(def.capability_id, def.name, def.description, def.trigger_hints.join(' '))
    })()
  }

  bm25Search(query: string, topK: number): Array<{ capability_id: string; rank: number }> {
    return this.db.prepare(`
      SELECT capability_id, rank
      FROM capabilities_fts
      WHERE capabilities_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, topK) as Array<{ capability_id: string; rank: number }>
  }

  close(): void { this.db.close() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/store/sqlite-cache.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/store/sqlite-cache.ts \
        claude-code/cli/src/satori/tests/store/sqlite-cache.test.ts
git commit -m "feat(satori): SQLite FTS5 cache for BM25 capability search"
```

---

### Task 1.5 — CC transcript adapter (adapters/claude-code.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/adapters/base.ts`
- Create: `claude-code/cli/src/satori/src/adapters/claude-code.ts`
- Create: `claude-code/cli/src/satori/tests/adapters/claude-code.test.ts`

- [ ] **Step 1: Create src/adapters/base.ts**

```typescript
import type { EventEnvelope } from '../types/events.js'
import type { CheckpointMap } from '../store/checkpoint.js'

export interface SessionAdapter {
  harness: 'claude_code' | 'codex' | 'opencode'
  /** Scan for new events since the last checkpoint. Yields normalized events in order. */
  scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope>
}
```

- [ ] **Step 2: Write failing test**

`tests/adapters/claude-code.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js'

const TMP = '/tmp/satori-cc-test'
mkdirSync(TMP, { recursive: true })

// Minimal CC transcript line (assistant turn with Skill tool_use)
const skillTurn = JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_01',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{
      type: 'tool_use',
      id:   'toolu_01',
      name: 'Skill',
      input: { skill: 'brainstorming' },
    }],
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  uuid: 'turn-1',
  parentUuid: null,
  isSidechain: false,
  isMeta: false,
  ts: '2026-06-17T10:00:00.000Z',
})

const sessionId = 'test-session-001'
const slug      = 'test-project'

test('ClaudeCodeAdapter emits capability.invoked for Skill tool_use', async () => {
  const projDir = join(TMP, slug)
  mkdirSync(projDir, { recursive: true })
  const transcript = join(projDir, `${sessionId}.jsonl`)
  writeFileSync(transcript, skillTurn + '\n')

  const adapter = new ClaudeCodeAdapter(TMP)
  const events: import('../../src/types/events.js').EventEnvelope[] = []
  for await (const ev of adapter.scan(new Map())) {
    events.push(ev)
  }

  const capInvoked = events.filter(e => e.event_type === 'capability.invoked')
  expect(capInvoked.length).toBeGreaterThan(0)
  const payload = capInvoked[0]?.payload as { capability_id: string; observability_level: string }
  expect(payload.capability_id).toBe('brainstorming')
  expect(payload.observability_level).toBe('observed')

  rmSync(TMP, { recursive: true })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/adapters/claude-code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create src/adapters/claude-code.ts**

```typescript
import { readdirSync, existsSync, statSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint, computePrefixHash, shouldRescan } from '../store/checkpoint.js'
import { makeTypedEvent, makeEventId, type EventEnvelope } from '../types/events.js'
import { CapabilityInvokedPayloadSchema } from '../types/events.js'

const DEFAULT_TRANSCRIPTS = join(homedir(), '.claude', 'projects')

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly harness = 'claude_code' as const

  constructor(private readonly transcriptsDir: string = DEFAULT_TRANSCRIPTS) {}

  async *scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope> {
    if (!existsSync(this.transcriptsDir)) return

    for (const slug of readdirSync(this.transcriptsDir)) {
      const projDir = join(this.transcriptsDir, slug)
      const stat = statSync(projDir)
      if (!stat.isDirectory()) continue

      for (const file of readdirSync(projDir).filter(f => f.endsWith('.jsonl'))) {
        const transcriptPath = join(projDir, file)
        const sessionId = basename(file, '.jsonl')
        const sourceId = `cc:${slug}/${sessionId}`
        const fstat = statSync(transcriptPath)
        const ck = getCheckpoint(checkpoints, sourceId)

        if (!shouldRescan(ck, fstat.ino, fstat.size, fstat.mtimeMs)) continue

        const content = readFileSync(transcriptPath, 'utf8')
        const lines = content.split('\n')
        const startOffset = ck?.last_complete_line_offset ?? 0
        let byteOffset = 0
        let lastCompleteOffset = startOffset

        for (const line of lines) {
          const lineByteLen = Buffer.byteLength(line, 'utf8') + 1 // +1 for \n
          if (byteOffset < startOffset) { byteOffset += lineByteLen; continue }

          if (!line.trim()) { byteOffset += lineByteLen; lastCompleteOffset = byteOffset; continue }

          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(line)
          } catch {
            console.warn(`[satori/cc] skipped malformed line at offset ${byteOffset} in ${transcriptPath}`)
            byteOffset += lineByteLen
            continue
          }

          yield* this.emitFromLine(parsed, sourceId, byteOffset, slug, sessionId, transcriptPath)
          byteOffset += lineByteLen
          lastCompleteOffset = byteOffset
        }

        saveCheckpoint(checkpoints, {
          source_id:                 sourceId,
          inode:                     fstat.ino,
          size:                      fstat.size,
          mtime:                     fstat.mtimeMs,
          prefix_hash:               computePrefixHash(content.slice(0, 4096)),
          last_complete_line_offset: lastCompleteOffset,
          last_scanned_at:           new Date().toISOString(),
        })
      }
    }
  }

  private *emitFromLine(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
    slug: string,
    sessionId: string,
    transcriptPath: string,
  ): Generator<EventEnvelope> {
    const ts = (parsed['ts'] as string | undefined) ?? new Date().toISOString()

    // assistant turn with tool_use
    if (parsed['type'] === 'assistant') {
      const msg = parsed['message'] as Record<string, unknown> | undefined
      const content = (msg?.['content'] as unknown[]) ?? []
      const turnIndex = typeof parsed['turnIndex'] === 'number' ? parsed['turnIndex'] : offset

      for (const block of content) {
        const b = block as Record<string, unknown>
        if (b['type'] === 'tool_use' && b['name'] === 'Skill') {
          const input = b['input'] as Record<string, unknown> | undefined
          const skillName = input?.['skill'] as string | undefined
          if (!skillName) continue
          const toolUseId = b['id'] as string | undefined

          yield makeTypedEvent('capability.invoked', sourceId, offset, 'claude_code', {
            session_id:          sessionId,
            turn_index:          turnIndex,
            capability_id:       skillName,
            capability_type:     'skill',
            harness:             'claude_code',
            trigger:             'model',
            tool_use_id:         toolUseId,
            observability_level: 'observed',
            confidence:          1.0,
          } satisfies import('../types/events.js').CapabilityInvokedPayload)
        }
      }
    }
  }
}

// Re-export the payload type so tests can reference it
export type { EventEnvelope }
```

> Note: `CapabilityInvokedPayload` must be added as an exported type alias in events.ts. Add to events.ts:
> ```typescript
> export type CapabilityInvokedPayload = z.infer<typeof CapabilityInvokedPayloadSchema>
> ```

- [ ] **Step 5: Add missing type export to src/types/events.ts**

Add at the end of `src/types/events.ts`:
```typescript
export type SessionObservedPayload    = z.infer<typeof SessionObservedPayloadSchema>
export type TurnObservedPayload       = z.infer<typeof TurnObservedPayloadSchema>
export type PromptObservedPayload     = z.infer<typeof PromptObservedPayloadSchema>
export type CapabilityInvokedPayload  = z.infer<typeof CapabilityInvokedPayloadSchema>
export type ToolCalledPayload         = z.infer<typeof ToolCalledPayloadSchema>
export type OutcomeObservedPayload    = z.infer<typeof OutcomeObservedPayloadSchema>
export type FeedbackObservedPayload   = z.infer<typeof FeedbackObservedPayloadSchema>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/adapters/claude-code.test.ts`
Expected: PASS (1 test)

- [ ] **Step 7: Commit**

```bash
git add claude-code/cli/src/satori/src/adapters/base.ts \
        claude-code/cli/src/satori/src/adapters/claude-code.ts \
        claude-code/cli/src/satori/src/types/events.ts \
        claude-code/cli/src/satori/tests/adapters/claude-code.test.ts
git commit -m "feat(satori): CC transcript adapter with Skill tool_use extraction"
```

---

### Task 1.6 — Evidence snapshot (store/evidence.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/store/evidence.ts`

- [ ] **Step 1: Create src/store/evidence.ts**

```typescript
import { z } from 'zod'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { EVIDENCE_DIR } from '../paths.js'

export const EvidenceSnapshotSchema = z.object({
  evidence_id:   z.string(),
  event_id:      z.string(),
  capability_id: z.string().optional(),
  finding_id:    z.string().optional(),
  excerpt:       z.string().max(300), // 280-char band + small buffer
  source_pointer: z.string(),
  snapshotted_at: z.string().datetime(),
})
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>

export function snapshotEvidence(
  eventId: string,
  sourcePointer: string,
  excerpt: string,
  opts: { capabilityId?: string; findingId?: string; evidenceDir?: string } = {},
): EvidenceSnapshot {
  const { capabilityId, findingId, evidenceDir = EVIDENCE_DIR } = opts
  const evidenceId = createHash('sha256').update(`${eventId}:${excerpt}`).digest('hex').slice(0, 16)
  const snapshot: EvidenceSnapshot = {
    evidence_id:    evidenceId,
    event_id:       eventId,
    capability_id:  capabilityId,
    finding_id:     findingId,
    excerpt:        excerpt.slice(0, 280),
    source_pointer: sourcePointer,
    snapshotted_at: new Date().toISOString(),
  }
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true })
  const path = join(evidenceDir, `${evidenceId}.json`)
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(snapshot, null, 2))
  return snapshot
}

export function loadEvidence(evidenceId: string, evidenceDir: string = EVIDENCE_DIR): EvidenceSnapshot | null {
  const path = join(evidenceDir, `${evidenceId}.json`)
  if (!existsSync(path)) return null
  return EvidenceSnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/store/evidence.ts
git commit -m "feat(satori): evidence snapshot-on-surface (280-char band, deduped by id)"
```

---

### Task 1.7 — Phase 1 integration test: CC session end-to-end

**Files:**
- Create: `claude-code/cli/src/satori/tests/integration/cc-ingest.test.ts`

- [ ] **Step 1: Write integration test**

`tests/integration/cc-ingest.test.ts`:
```typescript
import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js'
import { appendEvent, readEvents } from '../../src/store/event-log.js'
import { SatoriCache } from '../../src/store/sqlite-cache.js'

const TMP         = '/tmp/satori-integration-test'
const EVENTS_DIR  = join(TMP, 'events')
const DB_PATH     = join(TMP, 'cache.sqlite')
const PROJ_DIR    = join(TMP, 'transcripts', 'my-project')

mkdirSync(PROJ_DIR, { recursive: true })

const sessionId = 'sess-integration-001'
const lines = [
  JSON.stringify({
    type: 'user', uuid: 'u1', parentUuid: null, isSidechain: false, isMeta: false,
    ts: '2026-06-17T10:00:00.000Z',
    message: { role: 'user', content: 'brainstorm a feature' },
  }),
  JSON.stringify({
    type: 'assistant', uuid: 'a1', parentUuid: 'u1', isSidechain: false, isMeta: false,
    ts: '2026-06-17T10:00:02.000Z',
    message: {
      role: 'assistant', model: 'claude-sonnet-4-6',
      content: [{ type: 'tool_use', id: 'toolu_99', name: 'Skill', input: { skill: 'brainstorming' } }],
      usage: { input_tokens: 200, output_tokens: 80 },
    },
  }),
]
writeFileSync(join(PROJ_DIR, `${sessionId}.jsonl`), lines.join('\n') + '\n')

afterAll(() => rmSync(TMP, { recursive: true }))

test('end-to-end: CC transcript → event log → FTS5 cache → BM25 query', async () => {
  // 1. Scan with adapter
  const adapter = new ClaudeCodeAdapter(join(TMP, 'transcripts'))
  const checkpoints = new Map()
  const events = []
  for await (const ev of adapter.scan(checkpoints)) {
    events.push(ev)
    appendEvent(ev, EVENTS_DIR)
  }

  // 2. Verify capability.invoked event was emitted
  const capEvents = events.filter(e => e.event_type === 'capability.invoked')
  expect(capEvents.length).toBe(1)
  expect((capEvents[0]?.payload as { capability_id: string }).capability_id).toBe('brainstorming')

  // 3. Verify event is readable from JSONL log
  const date = '2026-06-17'
  const readBack = [...readEvents(date, 'claude_code', EVENTS_DIR)]
  expect(readBack.some(e => e.event_type === 'capability.invoked')).toBe(true)

  // 4. Upsert to FTS5 cache and BM25 search
  const cache = new SatoriCache(DB_PATH)
  cache.upsertCapability({
    capability_id: 'brainstorming', name: 'Brainstorming',
    description:   'Explores user intent and requirements before building',
    harness: 'claude_code', type: 'skill',
    path: '/skills/brainstorming/SKILL.md', content_hash: 'deadbeef',
    trigger_hints: ['feature', 'design', 'create'],
    scanned_at: '2026-06-17T10:00:00Z',
  })
  const results = cache.bm25Search('brainstorm feature', 5)
  expect(results[0]?.capability_id).toBe('brainstorming')
  cache.close()
})
```

- [ ] **Step 2: Run integration test**

Run: `cd claude-code/cli/src/satori && bun test tests/integration/cc-ingest.test.ts`
Expected: PASS (1 test — end-to-end green)

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `cd claude-code/cli/src/satori && bun test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add claude-code/cli/src/satori/tests/integration/cc-ingest.test.ts
git commit -m "test(satori): Phase 1 end-to-end CC ingest → event log → FTS5 green"
```

---

## Phase 2 — Analysis Grammar + Metric Implementations

**Independently shippable:** yes. Exit criteria: `bun test` passes all Phase 2 tests; Wilson CI and empirical-Bayes shrinkage produce correct values for known inputs; BM25 gap candidates return ranked results.

---

### Task 2.1 — Dimension extractors (analysis/dimensions.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/analysis/dimensions.ts`

- [ ] **Step 1: Create src/analysis/dimensions.ts**

```typescript
import type { EventEnvelope } from '../types/events.js'
import type { CapabilityInvokedPayload } from '../types/events.js'

export type DimensionKey =
  | 'capability'
  | 'harness'
  | 'workspace'
  | 'session'
  | 'date'
  | 'hour'
  | 'trigger'
  | 'observability_level'
  | 'intent_cluster'

export function extractDimension(event: EventEnvelope, dim: DimensionKey): string | undefined {
  switch (dim) {
    case 'harness':      return event.harness
    case 'session': {
      const p = event.payload as Record<string, unknown>
      return p['session_id'] as string | undefined
    }
    case 'capability': {
      if (event.event_type !== 'capability.invoked') return undefined
      return (event.payload as CapabilityInvokedPayload).capability_id
    }
    case 'trigger': {
      if (event.event_type !== 'capability.invoked') return undefined
      return (event.payload as CapabilityInvokedPayload).trigger
    }
    case 'observability_level': {
      if (event.event_type !== 'capability.invoked') return undefined
      return (event.payload as CapabilityInvokedPayload).observability_level
    }
    case 'intent_cluster': {
      if (event.event_type !== 'prompt.observed') return undefined
      return (event.payload as { intent_cluster_id?: string }).intent_cluster_id
    }
    case 'date':  return event.observed_at.slice(0, 10)
    case 'hour':  return event.observed_at.slice(0, 13)
    case 'workspace': {
      const p = event.payload as Record<string, unknown>
      return p['workspace'] as string | undefined
    }
    default:      return undefined
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/analysis/dimensions.ts
git commit -m "feat(satori): dimension extractors for split-apply-combine grammar"
```

---

### Task 2.2 — Metric implementations with Wilson CI + empirical-Bayes (analysis/metrics.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/analysis/metrics.ts`
- Create: `claude-code/cli/src/satori/tests/analysis/metrics.test.ts`

- [ ] **Step 1: Write failing test**

`tests/analysis/metrics.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { wilsonCI, empiricalBayesShrink, computeRateMetric } from '../../src/analysis/metrics.js'

test('wilsonCI returns [0,1] interval for 0/0', () => {
  const { lower, upper } = wilsonCI(0, 0)
  expect(lower).toBe(0)
  expect(upper).toBe(1)
})

test('wilsonCI upper > lower for 5/10 with z=1.96', () => {
  const { lower, upper, center } = wilsonCI(5, 10)
  expect(upper).toBeGreaterThan(lower)
  expect(center).toBeCloseTo(0.5, 1)
})

test('empiricalBayesShrink pulls 1/1 toward global mean', () => {
  const shrunk = empiricalBayesShrink(1, 1, 0.8, 100) // 1/1 raw, global=0.8
  expect(shrunk).toBeLessThan(1.0)
  expect(shrunk).toBeGreaterThan(0.8)
})

test('computeRateMetric returns null for n < minSample', () => {
  const result = computeRateMetric(3, 5, 10, 0.8, 100)
  expect(result).toBeNull()
})

test('computeRateMetric returns shrunken estimate for adequate sample', () => {
  const result = computeRateMetric(8, 10, 5, 0.7, 80)
  expect(result).not.toBeNull()
  expect(result!.shrunken).toBeGreaterThan(0.5)
  expect(result!.shrunken).toBeLessThan(1.0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/analysis/metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/analysis/metrics.ts**

```typescript
// Wilson score confidence interval (Agresti-Coull adjustment)
export function wilsonCI(successes: number, n: number, z = 1.96): {
  lower: number; upper: number; center: number
} {
  if (n === 0) return { lower: 0, upper: 1, center: 0.5 }
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const margin = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
  return {
    lower:  Math.max(0, center - margin),
    upper:  Math.min(1, center + margin),
    center,
  }
}

// Empirical-Bayes shrinkage: shrinks individual rate toward global mean
// alpha = global_mean * kappa, beta = (1 - global_mean) * kappa
// where kappa = concentration hyperparameter estimated from global_n
export function empiricalBayesShrink(
  successes: number,
  n: number,
  globalMean: number,
  globalN: number,
): number {
  const kappa = Math.max(1, globalN / 10) // simple concentration
  const alpha = globalMean * kappa
  const beta  = (1 - globalMean) * kappa
  return (successes + alpha) / (n + alpha + beta)
}

export interface RateMetricResult {
  raw:      number      // raw rate = successes/n
  shrunken: number      // empirical-Bayes shrunken rate
  ci:       { lower: number; upper: number; center: number }
  n:        number
}

// Returns null if n < minSample (refuse to rank low-N capabilities)
export function computeRateMetric(
  successes: number,
  n: number,
  minSample: number,
  globalMean: number,
  globalN: number,
): RateMetricResult | null {
  if (n < minSample) return null
  return {
    raw:      n === 0 ? 0 : successes / n,
    shrunken: empiricalBayesShrink(successes, n, globalMean, globalN),
    ci:       wilsonCI(successes, n),
    n,
  }
}

// Named metric keys (the "metrics" axis of the grammar)
export type MetricKey =
  | 'used_downstream_rate'
  | 'model_trigger_rate'
  | 'load_success_rate'
  | 'invocation_count'
  | 'session_count'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/analysis/metrics.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/analysis/metrics.ts \
        claude-code/cli/src/satori/tests/analysis/metrics.test.ts
git commit -m "feat(satori): Wilson CI and empirical-Bayes shrinkage for rate metrics"
```

---

### Task 2.3 — Split-apply-combine grammar engine (analysis/grammar.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/analysis/grammar.ts`
- Create: `claude-code/cli/src/satori/tests/analysis/grammar.test.ts`

- [ ] **Step 1: Write failing test**

`tests/analysis/grammar.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { groupBy, applyMetric, compareVsThreshold } from '../../src/analysis/grammar.js'
import { makeTypedEvent } from '../../src/types/events.js'

const events = [
  makeTypedEvent('capability.invoked', 'cc:p/s1', 0, 'claude_code', {
    session_id: 's1', turn_index: 0, capability_id: 'brainstorming',
    capability_type: 'skill', harness: 'claude_code', trigger: 'model',
    observability_level: 'observed', confidence: 1.0,
  }),
  makeTypedEvent('capability.invoked', 'cc:p/s1', 1, 'claude_code', {
    session_id: 's1', turn_index: 1, capability_id: 'brainstorming',
    capability_type: 'skill', harness: 'claude_code', trigger: 'model',
    observability_level: 'observed', confidence: 1.0,
  }),
  makeTypedEvent('capability.invoked', 'cc:p/s2', 0, 'claude_code', {
    session_id: 's2', turn_index: 0, capability_id: 'tdd',
    capability_type: 'skill', harness: 'claude_code', trigger: 'user',
    observability_level: 'observed', confidence: 1.0,
  }),
]

test('groupBy capability splits events correctly', () => {
  const groups = groupBy(events, e => {
    if (e.event_type !== 'capability.invoked') return undefined
    return (e.payload as { capability_id: string }).capability_id
  })
  expect(groups.get('brainstorming')?.length).toBe(2)
  expect(groups.get('tdd')?.length).toBe(1)
})

test('applyMetric count works', () => {
  const groups = groupBy(events, e => {
    if (e.event_type !== 'capability.invoked') return undefined
    return (e.payload as { capability_id: string }).capability_id
  })
  const counts = applyMetric(groups, events => events.length)
  expect(counts.get('brainstorming')).toBe(2)
  expect(counts.get('tdd')).toBe(1)
})

test('compareVsThreshold flags capabilities below threshold', () => {
  const counts = new Map([['brainstorming', 5], ['tdd', 1]])
  const flagged = compareVsThreshold(counts, 2)
  expect(flagged.has('tdd')).toBe(true)
  expect(flagged.has('brainstorming')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/analysis/grammar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/analysis/grammar.ts**

```typescript
import type { EventEnvelope } from '../types/events.js'

// Split: group events by a key function (undefined keys are skipped)
export function groupBy<K>(
  events: EventEnvelope[],
  keyFn: (ev: EventEnvelope) => K | undefined,
): Map<K, EventEnvelope[]> {
  const map = new Map<K, EventEnvelope[]>()
  for (const ev of events) {
    const key = keyFn(ev)
    if (key === undefined) continue
    const existing = map.get(key) ?? []
    existing.push(ev)
    map.set(key, existing)
  }
  return map
}

// Apply: compute a metric over each group
export function applyMetric<K, V>(
  groups: Map<K, EventEnvelope[]>,
  metricFn: (events: EventEnvelope[]) => V,
): Map<K, V> {
  const result = new Map<K, V>()
  for (const [key, events] of groups.entries()) {
    result.set(key, metricFn(events))
  }
  return result
}

// Combine operator: vs threshold → returns keys that fall below
export function compareVsThreshold<K>(
  metrics: Map<K, number>,
  threshold: number,
): Set<K> {
  const flagged = new Set<K>()
  for (const [key, value] of metrics.entries()) {
    if (value < threshold) flagged.add(key)
  }
  return flagged
}

// Combine operator: vs peers → rank by value descending
export function rankByMetric<K>(
  metrics: Map<K, number>,
): Array<{ key: K; value: number; rank: number }> {
  return [...metrics.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value], i) => ({ key, value, rank: i + 1 }))
}

// Combine operator: vs past → compute delta between two metric maps
export function vsBaseline<K>(
  current: Map<K, number>,
  baseline: Map<K, number>,
): Map<K, { current: number; baseline: number; delta: number }> {
  const result = new Map<K, { current: number; baseline: number; delta: number }>()
  for (const [key, cur] of current.entries()) {
    const base = baseline.get(key) ?? 0
    result.set(key, { current: cur, baseline: base, delta: cur - base })
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/analysis/grammar.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/analysis/grammar.ts \
        claude-code/cli/src/satori/tests/analysis/grammar.test.ts
git commit -m "feat(satori): split-apply-combine grammar engine (groupBy, applyMetric, compare operators)"
```

---

### Task 2.4 — Intent clustering + LLM cluster naming (analysis/intent.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/analysis/intent.ts`

- [ ] **Step 1: Create src/analysis/intent.ts**

```typescript
import { createHash } from 'crypto'
import type { IntentCluster } from '../types/projections.js'

// BM25 term sketch: extract top-N content words from a text (no raw text stored)
const STOPWORDS = new Set(['the','a','an','is','it','to','of','in','and','or','for','with','on','at','by'])

export function extractBm25Terms(text: string, topN = 12): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1)
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w)
}

// Cluster prompt events by term-overlap Jaccard similarity
// Each cluster = a set of bm25_term arrays that share ≥ threshold terms
export function clusterByTermOverlap(
  promptTermSets: Array<{ id: string; terms: string[] }>,
  threshold = 0.25,
): Map<string, string[]> {
  const clusters = new Map<string, string[]>() // cluster_id → [prompt_ids]
  const assigned = new Map<string, string>()    // prompt_id → cluster_id

  for (const { id, terms } of promptTermSets) {
    let bestClusterId: string | undefined
    let bestScore = 0
    for (const [clusterId, memberIds] of clusters.entries()) {
      // representative = first member's terms
      const repId = memberIds[0]
      const rep = promptTermSets.find(p => p.id === repId)?.terms ?? []
      const score = jaccard(terms, rep)
      if (score > bestScore && score >= threshold) {
        bestScore = score
        bestClusterId = clusterId
      }
    }
    if (bestClusterId) {
      clusters.get(bestClusterId)!.push(id)
      assigned.set(id, bestClusterId)
    } else {
      const newId = createHash('sha256').update(id).digest('hex').slice(0, 12)
      clusters.set(newId, [id])
      assigned.set(id, newId)
    }
  }
  return clusters
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

// Build IntentCluster objects from raw cluster map + term sets
export function buildIntentClusters(
  clusters: Map<string, string[]>,
  promptTermSets: Array<{ id: string; terms: string[]; ts: string }>,
  existingNames: Map<string, string> = new Map(),
): IntentCluster[] {
  return [...clusters.entries()].map(([clusterId, memberIds]) => {
    const members = memberIds.map(id => promptTermSets.find(p => p.id === id)!).filter(Boolean)
    const allTerms = members.flatMap(m => m.terms)
    const freq = new Map<string, number>()
    for (const t of allTerms) freq.set(t, (freq.get(t) ?? 0) + 1)
    const topTerms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)
    const lastTs = members.map(m => m.ts).sort().at(-1) ?? new Date().toISOString()
    return {
      cluster_id:    clusterId,
      name:          existingNames.get(clusterId) ?? topTerms.slice(0, 3).join('/'),
      bm25_terms:    topTerms,
      session_count: memberIds.length,
      last_seen:     lastTs,
    } satisfies IntentCluster
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/analysis/intent.ts
git commit -m "feat(satori): BM25 term extraction and Jaccard-based intent clustering"
```

---

### Task 2.5 — Gap detection with BM25 → LLM adjudication (analysis/gap-detection.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/analysis/gap-detection.ts`
- Create: `claude-code/cli/src/satori/tests/analysis/gap-detection.test.ts`

- [ ] **Step 1: Write failing test**

`tests/analysis/gap-detection.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { generateGapCandidates } from '../../src/analysis/gap-detection.js'

test('generateGapCandidates returns candidates ranked by BM25 score', () => {
  const promptTerms = ['brainstorm', 'feature', 'design', 'requirements']
  const firingCapabilities = new Set<string>(['writing-plans'])
  const bm25Results = [
    { capability_id: 'brainstorming', rank: -2.1 }, // lower rank = better in FTS5
    { capability_id: 'tdd', rank: -0.5 },
  ]
  const candidates = generateGapCandidates(promptTerms, firingCapabilities, bm25Results)
  // brainstorming didn't fire but is highly relevant → gap candidate
  expect(candidates.some(c => c.capability_id === 'brainstorming')).toBe(true)
  // writing-plans fired → not a gap
  expect(candidates.some(c => c.capability_id === 'writing-plans')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/analysis/gap-detection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/analysis/gap-detection.ts**

```typescript
export interface GapCandidate {
  capability_id: string
  bm25_rank:     number   // raw FTS5 rank (negative; more negative = better)
  fired:         boolean
  candidate_type: 'underused' | 'not_fired'
}

// Step 1: deterministic BM25 candidates (call before any LLM)
export function generateGapCandidates(
  promptTerms: string[],
  firingCapabilities: Set<string>,
  bm25Results: Array<{ capability_id: string; rank: number }>,
  topK = 5,
): GapCandidate[] {
  return bm25Results
    .slice(0, topK)
    .filter(r => !firingCapabilities.has(r.capability_id))
    .map(r => ({
      capability_id:  r.capability_id,
      bm25_rank:      r.rank,
      fired:          false,
      candidate_type: firingCapabilities.size === 0 ? 'not_fired' : 'underused',
    }))
}

// Step 2: LLM adjudication prompt builder (LLM called in consolidate.ts)
// Returns a structured prompt for the LLM to confirm/reject each candidate
export function buildGapAdjudicationPrompt(
  candidates: GapCandidate[],
  promptExcerpt: string,
  capabilityDescriptions: Map<string, string>,
): string {
  const lines = candidates.map(c => {
    const desc = capabilityDescriptions.get(c.capability_id) ?? '(no description)'
    return `- ${c.capability_id}: ${desc}`
  })
  return [
    'You are reviewing whether the user missed relevant capabilities during a session.',
    '',
    `Session context (excerpt): "${promptExcerpt}"`,
    '',
    'Capability candidates that did NOT fire (BM25-ranked):',
    ...lines,
    '',
    'For each candidate, output JSON conforming to GapConfirmationResponseSchema:',
    '{ capability_id, confirmed: bool, finding_type, severity, summary, counter_evidence[], confidence }',
    'Respond with a JSON array only. No prose.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/analysis/gap-detection.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/analysis/gap-detection.ts \
        claude-code/cli/src/satori/tests/analysis/gap-detection.test.ts
git commit -m "feat(satori): gap detection with BM25 candidate generation and LLM adjudication prompt"
```

---

## Phase 3 — Dream Loop + LLM Consolidation + Patch-Ops

**Independently shippable:** yes. Exit criteria: `satori dream --force` completes without error on a machine with CC sessions, writes `~/.satori/state/profile.md`, `backlog.jsonl`, and `findings.jsonl`.

---

### Task 3.1 — Patch-ops engine (dream/patch-ops.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/dream/patch-ops.ts`
- Create: `claude-code/cli/src/satori/tests/dream/patch-ops.test.ts`

- [ ] **Step 1: Write failing test**

`tests/dream/patch-ops.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { applyPatchOps } from '../../src/dream/patch-ops.js'
import type { PatchOp } from '../../src/types/llm-contracts.js'

type Item = { id: string; value: string; status: string }

const initial: Item[] = [
  { id: 'a', value: 'old', status: 'open' },
  { id: 'b', value: 'keep', status: 'open' },
]

test('keep op: item survives unchanged', () => {
  const ops: PatchOp[] = [{ op: 'keep', id: 'b' }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  expect(result.find(i => i.id === 'b')?.value).toBe('keep')
})

test('update op: merges patch fields', () => {
  const ops: PatchOp[] = [{ op: 'update', id: 'a', patch: { value: 'updated' }, evidence_ids: ['ev1'] }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  expect(result.find(i => i.id === 'a')?.value).toBe('updated')
})

test('drop op: sets status to superseded (tombstone, no delete)', () => {
  const ops: PatchOp[] = [{ op: 'drop', id: 'a', reason: 'stale' }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  const found = result.find(i => i.id === 'a')
  expect(found?.status).toBe('superseded')
})

test('new op: adds item to collection', () => {
  const ops: PatchOp[] = [{ op: 'new', item: { id: 'c', value: 'fresh', status: 'open' }, evidence_ids: ['ev2'] }]
  const result = applyPatchOps<Item>(initial, ops, i => i.id)
  expect(result.find(i => i.id === 'c')?.value).toBe('fresh')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/dream/patch-ops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/dream/patch-ops.ts**

```typescript
import type { PatchOp } from '../types/llm-contracts.js'

export function applyPatchOps<T extends Record<string, unknown>>(
  items: T[],
  ops: PatchOp[],
  idFn: (item: T) => string,
): T[] {
  const map = new Map<string, T>(items.map(i => [idFn(i), i]))
  const newItems: T[] = []

  for (const op of ops) {
    switch (op.op) {
      case 'keep':
        // no-op; item remains in map as-is
        break

      case 'update': {
        const existing = map.get(op.id)
        if (existing) map.set(op.id, { ...existing, ...op.patch } as T)
        break
      }

      case 'supersede': {
        // tombstone old, add new
        const existing = map.get(op.old_id)
        if (existing) map.set(op.old_id, { ...existing, status: 'superseded' } as T)
        const newItem = op.new_item as T
        newItems.push(newItem)
        break
      }

      case 'new':
        newItems.push(op.item as T)
        break

      case 'drop': {
        const existing = map.get(op.id)
        if (existing) map.set(op.id, { ...existing, status: 'superseded' } as T)
        break
      }
    }
  }

  return [...map.values(), ...newItems]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/dream/patch-ops.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/dream/patch-ops.ts \
        claude-code/cli/src/satori/tests/dream/patch-ops.test.ts
git commit -m "feat(satori): patch-ops engine (keep/update/supersede/new/drop, tombstone-not-delete)"
```

---

### Task 3.2 — Orient phase (dream/orient.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/dream/orient.ts`

- [ ] **Step 1: Create src/dream/orient.ts**

```typescript
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { STATE_DIR, CATALOG_DIR, STATE_MANIFEST } from '../paths.js'
import { StateManifestSchema, type StateManifest } from '../types/projections.js'
import { CatalogSnapshotSchema, type CatalogSnapshot } from '../types/catalog.js'

export interface OrientResult {
  manifest:        StateManifest | null
  catalogSnapshot: CatalogSnapshot | null
  profileExists:   boolean
  backlogCount:    number
  findingsCount:   number
}

export function orient(): OrientResult {
  // Load state manifest (what was the last build_through event?)
  let manifest: StateManifest | null = null
  if (existsSync(STATE_MANIFEST)) {
    try {
      manifest = StateManifestSchema.parse(JSON.parse(readFileSync(STATE_MANIFEST, 'utf8')))
    } catch { console.warn('[satori/orient] invalid manifest — will rebuild from scratch') }
  }

  // Load latest catalog snapshot (most recently written harness catalog)
  let catalogSnapshot: CatalogSnapshot | null = null
  if (existsSync(CATALOG_DIR)) {
    const files = (await import('fs')).readdirSync(CATALOG_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
    if (files[0]) {
      try {
        catalogSnapshot = CatalogSnapshotSchema.parse(
          JSON.parse(readFileSync(join(CATALOG_DIR, files[0]), 'utf8'))
        )
      } catch { console.warn('[satori/orient] invalid catalog snapshot') }
    }
  }

  // Count existing projections
  const profilePath  = join(STATE_DIR, 'profile.md')
  const backlogPath  = join(STATE_DIR, 'backlog.jsonl')
  const findingsPath = join(STATE_DIR, 'findings.jsonl')

  const countLines = (path: string) => {
    if (!existsSync(path)) return 0
    return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).length
  }

  return {
    manifest,
    catalogSnapshot,
    profileExists: existsSync(profilePath),
    backlogCount:  countLines(backlogPath),
    findingsCount: countLines(findingsPath),
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/dream/orient.ts
git commit -m "feat(satori): dream Phase 1 - orient (load manifest, catalog, count projections)"
```

---

### Task 3.3 — Gather phase (dream/gather.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/dream/gather.ts`

- [ ] **Step 1: Create src/dream/gather.ts**

```typescript
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { EVENTS_DIR } from '../paths.js'
import { readEvents } from '../store/event-log.js'
import type { EventEnvelope } from '../types/events.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import type { SessionAdapter } from '../adapters/base.js'

export interface GatherResult {
  newEvents:     EventEnvelope[]
  eventsScanned: number
  sourcesScanned: number
}

// Run all adapters, collect new events since last checkpoint
export async function gather(
  adapters: SessionAdapter[],
  checkpoints: CheckpointMap,
  lookbackDays: number,
): Promise<GatherResult> {
  const newEvents: EventEnvelope[] = []
  let sourcesScanned = 0

  for (const adapter of adapters) {
    let count = 0
    for await (const ev of adapter.scan(checkpoints)) {
      newEvents.push(ev)
      count++
    }
    sourcesScanned++
    console.log(`[satori/gather] ${adapter.harness}: +${count} events`)
  }

  // Also read recent event log partitions (for projection rebuild)
  const eventsFromLog: EventEnvelope[] = []
  if (existsSync(EVENTS_DIR)) {
    const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
    const dates = readdirSync(EVENTS_DIR).filter(d => d >= cutoff).sort()
    for (const date of dates) {
      eventsFromLog.push(...readEvents(date, undefined, EVENTS_DIR))
    }
  }

  return {
    newEvents,
    eventsScanned: eventsFromLog.length,
    sourcesScanned,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/dream/gather.ts
git commit -m "feat(satori): dream Phase 2 - gather (run adapters, collect new events)"
```

---

### Task 3.4 — Consolidate phase (dream/consolidate.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/dream/consolidate.ts`
- Create: `claude-code/cli/src/satori/tests/dream/consolidate.test.ts`

- [ ] **Step 1: Write failing test**

`tests/dream/consolidate.test.ts`:
```typescript
import { test, expect } from 'bun:test'
import { buildMetricProjections } from '../../src/dream/consolidate.js'
import { makeTypedEvent } from '../../src/types/events.js'

const events = [
  makeTypedEvent('capability.invoked', 'cc:p/s1', 0, 'claude_code', {
    session_id: 's1', turn_index: 0, capability_id: 'brainstorming',
    capability_type: 'skill', harness: 'claude_code', trigger: 'model',
    observability_level: 'observed', confidence: 1.0,
  }),
  makeTypedEvent('outcome.observed', 'cc:p/s1', 1, 'claude_code', {
    tool_use_id: 'toolu_01', session_id: 's1',
    status: 'success', used_downstream: true,
    attribution: { skill: 'brainstorming' },
  }),
]

test('buildMetricProjections counts invocations per capability', () => {
  const proj = buildMetricProjections(events, 5)
  const b = proj.get('brainstorming')
  expect(b?.invocation_count).toBe(1)
})

test('buildMetricProjections computes used_downstream_rate for observed events', () => {
  const proj = buildMetricProjections(events, 1) // minSample=1
  const b = proj.get('brainstorming')
  expect(b?.used_downstream_rate).not.toBeNull()
  expect(b?.used_downstream_rate?.raw).toBe(1.0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/dream/consolidate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/dream/consolidate.ts**

```typescript
import type { EventEnvelope, CapabilityInvokedPayload, OutcomeObservedPayload } from '../types/events.js'
import { groupBy } from '../analysis/grammar.js'
import { computeRateMetric, type RateMetricResult } from '../analysis/metrics.js'

export interface CapabilityMetrics {
  capability_id:        string
  invocation_count:     number
  session_count:        number
  used_downstream_rate: RateMetricResult | null   // only for 'observed' events
  load_success_rate:    RateMetricResult | null    // only for 'observed' events
  model_trigger_rate:   RateMetricResult | null
}

export function buildMetricProjections(
  events: EventEnvelope[],
  minSample: number,
): Map<string, CapabilityMetrics> {
  // Index outcomes by tool_use_id for join
  const outcomesByToolUseId = new Map<string, OutcomeObservedPayload>()
  for (const ev of events.filter(e => e.event_type === 'outcome.observed')) {
    const p = ev.payload as OutcomeObservedPayload
    if (p.tool_use_id) outcomesByToolUseId.set(p.tool_use_id, p)
  }

  const capInvocations = events.filter(e => e.event_type === 'capability.invoked')
  const groups = groupBy(capInvocations, e => (e.payload as CapabilityInvokedPayload).capability_id)

  const result = new Map<string, CapabilityMetrics>()
  const globalTotals = { downstreamHits: 0, downstreamN: 0, successHits: 0, successN: 0 }

  for (const [capId, evs] of groups.entries()) {
    const observed = evs.filter(e => (e.payload as CapabilityInvokedPayload).observability_level === 'observed')
    const sessions = new Set(evs.map(e => (e.payload as CapabilityInvokedPayload).session_id))
    const modelTriggers = evs.filter(e => (e.payload as CapabilityInvokedPayload).trigger === 'model')

    let downstreamHits = 0, successHits = 0
    for (const ev of observed) {
      const p = ev.payload as CapabilityInvokedPayload
      const outcome = p.tool_use_id ? outcomesByToolUseId.get(p.tool_use_id) : undefined
      if (outcome?.used_downstream) downstreamHits++
      if (outcome?.status === 'success') successHits++
      globalTotals.downstreamHits += outcome?.used_downstream ? 1 : 0
      globalTotals.downstreamN++
      globalTotals.successHits += outcome?.status === 'success' ? 1 : 0
      globalTotals.successN++
    }

    result.set(capId, {
      capability_id:        capId,
      invocation_count:     evs.length,
      session_count:        sessions.size,
      used_downstream_rate: computeRateMetric(
        downstreamHits, observed.length, minSample,
        globalTotals.downstreamN > 0 ? globalTotals.downstreamHits / globalTotals.downstreamN : 0.5,
        globalTotals.downstreamN,
      ),
      load_success_rate: computeRateMetric(
        successHits, observed.length, minSample,
        globalTotals.successN > 0 ? globalTotals.successHits / globalTotals.successN : 0.8,
        globalTotals.successN,
      ),
      model_trigger_rate: computeRateMetric(
        modelTriggers.length, evs.length, minSample,
        0.7, evs.length,
      ),
    })
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/dream/consolidate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/dream/consolidate.ts \
        claude-code/cli/src/satori/tests/dream/consolidate.test.ts
git commit -m "feat(satori): dream Phase 3 - metric projection builder (Wilson CI + empirical-Bayes)"
```

---

### Task 3.5 — Prune phase + profile/backlog/findings projections

**Files:**
- Create: `claude-code/cli/src/satori/src/dream/prune.ts`
- Create: `claude-code/cli/src/satori/src/projections/profile.ts`
- Create: `claude-code/cli/src/satori/src/projections/backlog.ts`
- Create: `claude-code/cli/src/satori/src/projections/findings.ts`

- [ ] **Step 1: Create src/dream/prune.ts**

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../paths.js'
import { FindingSchema, BacklogItemSchema } from '../types/projections.js'
import type { Finding, BacklogItem } from '../types/projections.js'

// Age out findings and backlog items past their expiry; rebuild JSONL files
export function pruneAndIndex(retentionDays: number): void {
  const now = new Date()
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString()

  pruneJsonl<Finding>(
    join(STATE_DIR, 'findings.jsonl'),
    FindingSchema,
    item => item.status === 'open' && (!item.expires_at || item.expires_at > cutoff),
  )

  pruneJsonl<BacklogItem>(
    join(STATE_DIR, 'backlog.jsonl'),
    BacklogItemSchema,
    item => item.status === 'open' && (!item.expires_at || item.expires_at > cutoff),
  )
}

function pruneJsonl<T>(
  path: string,
  schema: { parse: (v: unknown) => T },
  keepFn: (item: T) => boolean,
): void {
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim())
  const kept: string[] = []
  for (const line of lines) {
    try {
      const item = schema.parse(JSON.parse(line))
      if (keepFn(item)) kept.push(JSON.stringify(item))
    } catch { /* skip malformed */ }
  }
  writeFileSync(path, kept.join('\n') + (kept.length ? '\n' : ''))
}
```

- [ ] **Step 2: Create src/projections/profile.ts**

```typescript
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../paths.js'
import type { CapabilityMetrics } from '../dream/consolidate.js'
import type { IntentCluster } from '../types/projections.js'

export function renderProfileMd(
  metrics: Map<string, CapabilityMetrics>,
  clusters: IntentCluster[],
  harness: string,
): string {
  const topByInvocations = [...metrics.values()]
    .sort((a, b) => b.invocation_count - a.invocation_count)
    .slice(0, 10)

  const lines = [
    '# Satori — Capability Profile',
    `_Last updated: ${new Date().toISOString()}_`,
    '',
    '## Top capabilities by invocation',
    '| Capability | Invocations | Sessions | Downstream% | Success% |',
    '|---|---|---|---|---|',
    ...topByInvocations.map(m =>
      `| ${m.capability_id} | ${m.invocation_count} | ${m.session_count} ` +
      `| ${fmtRate(m.used_downstream_rate)} | ${fmtRate(m.load_success_rate)} |`
    ),
    '',
    '## Recurring intent clusters',
    ...clusters.slice(0, 8).map(c => `- **${c.name}** (${c.session_count} sessions): \`${c.bm25_terms.slice(0,4).join(', ')}\``),
  ]
  return lines.join('\n')
}

function fmtRate(r: { shrunken: number; n: number } | null): string {
  if (!r) return 'n/a'
  return `${(r.shrunken * 100).toFixed(0)}% (n=${r.n})`
}

export function writeProfile(
  metrics: Map<string, CapabilityMetrics>,
  clusters: IntentCluster[],
  harness = 'claude_code',
): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(join(STATE_DIR, 'profile.md'), renderProfileMd(metrics, clusters, harness))
  // Also write machine-readable profile.json
  const json = {
    generated_at: new Date().toISOString(),
    capabilities: [...metrics.values()],
    intent_clusters: clusters,
  }
  writeFileSync(join(STATE_DIR, 'profile.json'), JSON.stringify(json, null, 2))
}
```

- [ ] **Step 3: Create src/projections/findings.ts**

```typescript
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../paths.js'
import type { Finding } from '../types/projections.js'
import { createHash } from 'crypto'

export function appendFinding(finding: Finding): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  appendFileSync(join(STATE_DIR, 'findings.jsonl'), JSON.stringify(finding) + '\n')
}

export function makeFindingId(capabilityId: string, type: string, ts: string): string {
  return createHash('sha256').update(`${capabilityId}:${type}:${ts}`).digest('hex').slice(0, 16)
}
```

- [ ] **Step 4: Create src/projections/backlog.ts**

```typescript
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../paths.js'
import type { BacklogItem } from '../types/projections.js'
import { createHash } from 'crypto'

export function appendBacklogItem(item: BacklogItem): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  appendFileSync(join(STATE_DIR, 'backlog.jsonl'), JSON.stringify(item) + '\n')
}

export function makeBacklogItemId(capabilityId: string, type: string, ts: string): string {
  return createHash('sha256').update(`${capabilityId}:${type}:${ts}`).digest('hex').slice(0, 16)
}
```

- [ ] **Step 5: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/satori/src/dream/prune.ts \
        claude-code/cli/src/satori/src/projections/profile.ts \
        claude-code/cli/src/satori/src/projections/findings.ts \
        claude-code/cli/src/satori/src/projections/backlog.ts
git commit -m "feat(satori): prune phase + profile/findings/backlog projection writers"
```

---

### Task 3.6 — Dream orchestrator (dream/dream.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/dream/dream.ts`

- [ ] **Step 1: Create src/dream/dream.ts**

```typescript
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { dreamLock } from '../lock.js'
import { loadConfig } from '../config.js'
import { loadCheckpoints, saveCheckpoint } from '../store/checkpoint.js'
import { appendEvent } from '../store/event-log.js'
import { EVENTS_DIR, STATE_DIR, STATE_MANIFEST, CHECKPOINTS_FILE } from '../paths.js'
import { ClaudeCodeAdapter } from '../adapters/claude-code.js'
import { orient } from './orient.js'
import { gather } from './gather.js'
import { buildMetricProjections } from './consolidate.js'
import { pruneAndIndex } from './prune.js'
import { writeProfile } from '../projections/profile.js'
import { clusterByTermOverlap, buildIntentClusters } from '../analysis/intent.js'
import type { SessionAdapter } from '../adapters/base.js'
import type { StateManifest } from '../types/projections.js'

export interface DreamRunResult {
  eventsIngested: number
  metricsComputed: number
  clustersFound: number
  durationMs: number
}

export async function runDream(opts: { force?: boolean } = {}): Promise<DreamRunResult> {
  const t0 = Date.now()
  const config = loadConfig()

  return dreamLock.withLock(async () => {
    // Phase 1: Orient
    const orientation = orient()
    console.log('[satori/dream] Phase 1 Orient complete')

    // Phase 2: Gather
    const adapters: SessionAdapter[] = []
    if (config.harnesses.includes('claude_code')) {
      adapters.push(new ClaudeCodeAdapter())
    }
    // codex and opencode adapters added in Phase 4

    const checkpoints = loadCheckpoints(CHECKPOINTS_FILE)
    const { newEvents } = await gather(adapters, checkpoints, config.lookback_days)

    for (const ev of newEvents) appendEvent(ev)
    saveCheckpoint(checkpoints, {
      source_id:                 '_dream_pass',
      last_complete_line_offset: 0,
      last_scanned_at:           new Date().toISOString(),
    }, CHECKPOINTS_FILE)
    console.log(`[satori/dream] Phase 2 Gather: +${newEvents.length} events`)

    // Phase 3: Consolidate — rebuild projections from full event log
    const { readdirSync, readFileSync } = await import('fs')
    const allEvents = []
    if (existsSync(EVENTS_DIR)) {
      const dates = readdirSync(EVENTS_DIR).sort()
      for (const date of dates) {
        const { readEvents } = await import('../store/event-log.js')
        allEvents.push(...readEvents(date))
      }
    }

    const metrics = buildMetricProjections(allEvents, config.min_sample_threshold)

    // Intent clustering from prompt events
    const promptEvents = allEvents.filter(e => e.event_type === 'prompt.observed')
    const termSets = promptEvents.map(e => ({
      id:    e.event_id,
      terms: ((e.payload as { features?: { bm25_terms?: string[] } }).features?.bm25_terms ?? []),
      ts:    e.observed_at,
    }))
    const clusterMap = clusterByTermOverlap(termSets)
    const clusters = buildIntentClusters(clusterMap, termSets)

    // Write projections
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
    writeProfile(metrics, clusters)

    // Update manifest
    const lastEvent = allEvents.at(-1)
    const manifest: StateManifest = {
      schema_version:         1,
      built_through_event_id: lastEvent?.event_id ?? 'none',
      built_at:               new Date().toISOString(),
      generation:             (orientation.manifest?.generation ?? 0) + 1,
    }
    writeFileSync(STATE_MANIFEST, JSON.stringify(manifest, null, 2))
    console.log(`[satori/dream] Phase 3 Consolidate: ${metrics.size} capabilities, ${clusters.length} clusters`)

    // Phase 4: Prune
    pruneAndIndex(config.evidence_retention_days)
    console.log('[satori/dream] Phase 4 Prune complete')

    return {
      eventsIngested:  newEvents.length,
      metricsComputed: metrics.size,
      clustersFound:   clusters.length,
      durationMs:      Date.now() - t0,
    }
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/dream/dream.ts
git commit -m "feat(satori): 4-phase dream orchestrator with lock guard and manifest update"
```

---

## Phase 4 — Codex + OpenCode Adapters

**Independently shippable:** yes (after Phase 1). Exit criteria: `bun test` passes Codex and OpenCode adapter tests; a tri-harness `satori dream --force` emits events tagged with all three harness values.

---

### Task 4.1 — Codex adapter (adapters/codex.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/adapters/codex.ts`
- Create: `claude-code/cli/src/satori/tests/adapters/codex.test.ts`

- [ ] **Step 1: Write failing test**

`tests/adapters/codex.test.ts`:
```typescript
import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { CodexAdapter } from '../../src/adapters/codex.js'

const TMP      = '/tmp/satori-codex-test'
const SESS_DIR = join(TMP, '2026', '06', '17')
mkdirSync(SESS_DIR, { recursive: true })
afterAll(() => rmSync(TMP, { recursive: true }))

// Minimal Codex session file with a function_call to a SKILL.md file
const sessionLines = [
  JSON.stringify({ type: 'session_meta',  payload: { id: 'codex-sess-001', task: 'write tests' }, timestamp: '2026-06-17T10:00:00Z' }),
  JSON.stringify({ type: 'response_item', payload: {
    type: 'function_call', id: 'fc_01',
    name: 'exec_command',
    arguments: JSON.stringify({ command: `cat ${join(TMP, 'skills', 'tdd', 'SKILL.md')}` }),
  }, timestamp: '2026-06-17T10:00:05Z' }),
  JSON.stringify({ type: 'event_msg',     payload: { type: 'task_complete', output: 'done' }, timestamp: '2026-06-17T10:00:10Z' }),
]
const sessionFile = join(SESS_DIR, 'rollout-2026-06-17T10:00:00Z-codex-sess-001.jsonl')
writeFileSync(sessionFile, sessionLines.join('\n') + '\n')

// Create a fake SKILL.md so path resolution works
mkdirSync(join(TMP, 'skills', 'tdd'), { recursive: true })
writeFileSync(join(TMP, 'skills', 'tdd', 'SKILL.md'), '# TDD\nTest-driven development.\n')

test('CodexAdapter emits capability.invoked (inferred) for function_call to SKILL.md', async () => {
  const adapter = new CodexAdapter(TMP, join(TMP, 'skills'))
  const events = []
  for await (const ev of adapter.scan(new Map())) events.push(ev)

  const cap = events.filter(e => e.event_type === 'capability.invoked')
  expect(cap.length).toBeGreaterThan(0)
  const p = cap[0]?.payload as { observability_level: string; capability_id: string }
  expect(p.observability_level).toBe('inferred')
  expect(p.capability_id).toBe('tdd')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/adapters/codex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/adapters/codex.ts**

```typescript
import { readdirSync, existsSync, statSync, readFileSync } from 'fs'
import { join, basename, relative } from 'path'
import { homedir } from 'os'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint, computePrefixHash, shouldRescan } from '../store/checkpoint.js'
import { makeTypedEvent, makeEventId, type EventEnvelope } from '../types/events.js'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')
const DEFAULT_SKILLS_DIR   = join(homedir(), '.codex', 'skills')

export class CodexAdapter implements SessionAdapter {
  readonly harness = 'codex' as const

  constructor(
    private readonly sessionsDir: string = DEFAULT_SESSIONS_DIR,
    private readonly skillsDir:   string = DEFAULT_SKILLS_DIR,
  ) {}

  async *scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope> {
    if (!existsSync(this.sessionsDir)) return

    // Walk YYYY/MM/DD directories
    for (const year of readdirSync(this.sessionsDir)) {
      const yearDir = join(this.sessionsDir, year)
      if (!statSync(yearDir).isDirectory()) continue
      for (const month of readdirSync(yearDir)) {
        const monthDir = join(yearDir, month)
        if (!statSync(monthDir).isDirectory()) continue
        for (const day of readdirSync(monthDir)) {
          const dayDir = join(monthDir, day)
          if (!statSync(dayDir).isDirectory()) continue
          for (const file of readdirSync(dayDir).filter(f => f.endsWith('.jsonl'))) {
            yield* this.scanFile(join(dayDir, file), checkpoints)
          }
        }
      }
    }
  }

  private *scanFile(filePath: string, checkpoints: CheckpointMap): Generator<EventEnvelope> {
    const sourceId = `codex:${relative(this.sessionsDir, filePath)}`
    const fstat = statSync(filePath)
    const ck = getCheckpoint(checkpoints, sourceId)
    if (!shouldRescan(ck, fstat.ino, fstat.size, fstat.mtimeMs)) return

    const content = readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    let byteOffset = 0
    let lastCompleteOffset = ck?.last_complete_line_offset ?? 0
    const startOffset = lastCompleteOffset

    for (const line of lines) {
      const lineLen = Buffer.byteLength(line, 'utf8') + 1
      if (byteOffset < startOffset) { byteOffset += lineLen; continue }
      if (!line.trim()) { byteOffset += lineLen; lastCompleteOffset = byteOffset; continue }

      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(line) }
      catch { byteOffset += lineLen; continue }

      yield* this.emitFromLine(parsed, sourceId, byteOffset)
      byteOffset += lineLen
      lastCompleteOffset = byteOffset
    }

    saveCheckpoint(checkpoints, {
      source_id:                 sourceId,
      inode:                     fstat.ino,
      size:                      fstat.size,
      mtime:                     fstat.mtimeMs,
      prefix_hash:               computePrefixHash(content.slice(0, 4096)),
      last_complete_line_offset: lastCompleteOffset,
      last_scanned_at:           new Date().toISOString(),
    })
  }

  private *emitFromLine(
    parsed: Record<string, unknown>,
    sourceId: string,
    offset: number,
  ): Generator<EventEnvelope> {
    if (parsed['type'] !== 'response_item') return
    const payload = parsed['payload'] as Record<string, unknown> | undefined
    if (payload?.['type'] !== 'function_call') return

    const argsStr = payload['arguments'] as string | undefined
    if (!argsStr) return

    let args: Record<string, unknown>
    try { args = JSON.parse(argsStr) }
    catch { return }

    const command = args['command'] as string | undefined
    if (!command) return

    // Detect `cat <skillsDir>/<name>/SKILL.md` or `<skillsDir>/<name>/SKILL.md` patterns
    const skillMatch = command.match(new RegExp(`${this.skillsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/\\s]+)/SKILL\\.md`))
    if (!skillMatch) return

    const skillName = skillMatch[1]!
    const ts = (parsed['timestamp'] as string | undefined) ?? new Date().toISOString()

    yield makeTypedEvent('capability.invoked', sourceId, offset, 'codex', {
      session_id:          basename(sourceId).replace('.jsonl', ''),
      turn_index:          offset,
      capability_id:       skillName,
      capability_type:     'skill',
      harness:             'codex',
      trigger:             'model',
      observability_level: 'inferred',
      confidence:          0.7,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/adapters/codex.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/satori/src/adapters/codex.ts \
        claude-code/cli/src/satori/tests/adapters/codex.test.ts
git commit -m "feat(satori): Codex adapter - inferred capability.invoked from exec_command SKILL.md reads"
```

---

### Task 4.2 — OpenCode adapter (adapters/opencode.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/adapters/opencode.ts`
- Create: `claude-code/cli/src/satori/tests/adapters/opencode.test.ts`

- [ ] **Step 1: Write failing test**

`tests/adapters/opencode.test.ts`:
```typescript
import { test, expect, afterAll } from 'bun:test'
import { rmSync, existsSync } from 'fs'
import Database from 'better-sqlite3'
import { OpenCodeAdapter } from '../../src/adapters/opencode.js'

const DB_PATH = '/tmp/satori-opencode-test.db'
afterAll(() => { if (existsSync(DB_PATH)) rmSync(DB_PATH) })

function createTestDb(): void {
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, title TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, time INTEGER);
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
      time_start INTEGER, time_end INTEGER,
      data TEXT -- JSON
    );
  `)
  db.prepare(`INSERT INTO session VALUES ('oc-sess-001', 1718600000000, 'test session')`).run()
  db.prepare(`INSERT INTO message VALUES ('msg-001', 'oc-sess-001', 'assistant', 1718600001000)`).run()
  // Simulate an agent invocation in the `part.data` JSON
  const partData = JSON.stringify({ type: 'agent', agent_id: 'code-review', input: {} })
  db.prepare(`INSERT INTO part VALUES ('part-001', 'msg-001', 'oc-sess-001', 1718600001000, 1718600002000, ?)`).run(partData)
  db.close()
}

createTestDb()

test('OpenCodeAdapter emits capability.invoked (inferred) for agent part', async () => {
  const adapter = new OpenCodeAdapter(DB_PATH)
  const events = []
  for await (const ev of adapter.scan(new Map())) events.push(ev)

  const cap = events.filter(e => e.event_type === 'capability.invoked')
  expect(cap.length).toBeGreaterThan(0)
  const p = cap[0]?.payload as { capability_id: string; observability_level: string; capability_type: string }
  expect(p.capability_id).toBe('code-review')
  expect(p.observability_level).toBe('inferred')
  expect(p.capability_type).toBe('agent')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-code/cli/src/satori && bun test tests/adapters/opencode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/adapters/opencode.ts**

```typescript
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import type { SessionAdapter } from './base.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import { getCheckpoint, saveCheckpoint } from '../store/checkpoint.js'
import { makeTypedEvent, type EventEnvelope } from '../types/events.js'

const DEFAULT_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface PartRow {
  id:         string
  message_id: string
  session_id: string
  time_start: number
  data:       string
}

export class OpenCodeAdapter implements SessionAdapter {
  readonly harness = 'opencode' as const

  constructor(private readonly dbPath: string = DEFAULT_DB) {}

  async *scan(checkpoints: CheckpointMap): AsyncGenerator<EventEnvelope> {
    if (!existsSync(this.dbPath)) return

    const db = new Database(this.dbPath, { readonly: true })
    try {
      const ck = getCheckpoint(checkpoints, `opencode:${this.dbPath}`)
      const lastRowid = (ck?.last_complete_line_offset ?? 0)

      // Use rowid as stable pagination key (SQLite rowids are monotonic for appends)
      const rows = db.prepare(
        `SELECT p.id, p.message_id, p.session_id, p.time_start, p.data
         FROM part p
         WHERE p.rowid > ?
         ORDER BY p.rowid ASC`
      ).all(lastRowid) as PartRow[]

      for (const row of rows) {
        let data: Record<string, unknown>
        try { data = JSON.parse(row.data) }
        catch { continue }

        // Detect agent or command invocations in part data
        if (data['type'] === 'agent' && typeof data['agent_id'] === 'string') {
          yield makeTypedEvent('capability.invoked', `opencode:${this.dbPath}`, row.id, 'opencode', {
            session_id:          row.session_id,
            turn_index:          row.time_start,
            capability_id:       data['agent_id'] as string,
            capability_type:     'agent',
            harness:             'opencode',
            trigger:             'model',
            observability_level: 'inferred',
            confidence:          0.7,
          })
        } else if (data['type'] === 'command' && typeof data['command_id'] === 'string') {
          yield makeTypedEvent('capability.invoked', `opencode:${this.dbPath}`, row.id, 'opencode', {
            session_id:          row.session_id,
            turn_index:          row.time_start,
            capability_id:       data['command_id'] as string,
            capability_type:     'command',
            harness:             'opencode',
            trigger:             'user',
            observability_level: 'inferred',
            confidence:          0.8,
          })
        }
      }

      // Update checkpoint using last processed rowid
      if (rows.length > 0) {
        const lastRow = rows.at(-1)!
        const lastRowRowid = db.prepare(`SELECT rowid FROM part WHERE id = ?`).get(lastRow.id) as { rowid: number }
        saveCheckpoint(checkpoints, {
          source_id:                 `opencode:${this.dbPath}`,
          last_complete_line_offset: lastRowRowid.rowid,
          last_scanned_at:           new Date().toISOString(),
        })
      }
    } finally {
      db.close()
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd claude-code/cli/src/satori && bun test tests/adapters/opencode.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Wire Codex + OpenCode adapters into dream.ts**

In `src/dream/dream.ts`, update the adapter instantiation block:
```typescript
// Replace the existing adapter block with:
if (config.harnesses.includes('claude_code')) {
  adapters.push(new ClaudeCodeAdapter())
}
if (config.harnesses.includes('codex')) {
  const { CodexAdapter } = await import('../adapters/codex.js')
  adapters.push(new CodexAdapter())
}
if (config.harnesses.includes('opencode')) {
  const { OpenCodeAdapter } = await import('../adapters/opencode.js')
  adapters.push(new OpenCodeAdapter())
}
```

- [ ] **Step 6: Run full test suite**

Run: `cd claude-code/cli/src/satori && bun test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add claude-code/cli/src/satori/src/adapters/opencode.ts \
        claude-code/cli/src/satori/tests/adapters/opencode.test.ts \
        claude-code/cli/src/satori/src/dream/dream.ts
git commit -m "feat(satori): OpenCode adapter + wire tri-harness adapters into dream orchestrator"
```

---

## Phase 5 — Commands + CLI + HTML Report

**Independently shippable:** yes (after Phase 3). Exit criteria: `bun run src/cli/index.ts dream --force` runs end-to-end; `bun run src/cli/index.ts report --serve` opens an HTML page; `/satori` slash command is available in Claude Code.

---

### Task 5.1 — HTML report generator (report/html.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/report/html.ts`

- [ ] **Step 1: Create src/report/html.ts**

```typescript
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../paths.js'
import type { CapabilityMetrics } from '../dream/consolidate.js'
import { FindingSchema, BacklogItemSchema } from '../types/projections.js'

export function generateReport(metricsMap: Map<string, CapabilityMetrics>): string {
  const findings = loadJsonl(join(STATE_DIR, 'findings.jsonl'), FindingSchema.parse)
  const backlog  = loadJsonl(join(STATE_DIR, 'backlog.jsonl'),  BacklogItemSchema.parse)
  const profileMd = existsSync(join(STATE_DIR, 'profile.md'))
    ? readFileSync(join(STATE_DIR, 'profile.md'), 'utf8') : ''

  const openFindings = findings.filter(f => f.status === 'open')
  const openBacklog  = backlog.filter(b => b.status === 'open')

  const health = openFindings.filter(f => f.severity === 'high').length === 0
    ? 'green' : openFindings.filter(f => f.severity === 'high').length < 3 ? 'amber' : 'red'

  const healthLabel = health === 'green' ? '✓ Healthy' : health === 'amber' ? '⚠ Issues found' : '✗ Action needed'
  const healthBg = health === 'green' ? '#22c55e' : health === 'amber' ? '#f59e0b' : '#ef4444'

  const rows = [...metricsMap.values()]
    .sort((a, b) => b.invocation_count - a.invocation_count)
    .map(m => `
      <tr>
        <td>${escHtml(m.capability_id)}</td>
        <td>${m.invocation_count}</td>
        <td>${m.session_count}</td>
        <td>${fmtRate(m.used_downstream_rate)}</td>
        <td>${fmtRate(m.load_success_rate)}</td>
      </tr>`).join('')

  const findingRows = openFindings
    .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity))
    .map(f => `<tr><td>${escHtml(f.capability_id)}</td><td>${escHtml(f.type)}</td>
      <td><span class="badge ${f.severity}">${f.severity}</span></td>
      <td>${escHtml(f.summary)}</td></tr>`).join('')

  const backlogRows = openBacklog
    .sort((a, b) => b.confidence - a.confidence)
    .map(b => `<tr><td>${escHtml(b.capability_id ?? '—')}</td><td>${escHtml(b.type)}</td>
      <td>${escHtml(b.title)}</td><td>${escHtml(b.route)}</td>
      <td>${(b.confidence * 100).toFixed(0)}%</td></tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Satori Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 2rem; background: #0f172a; color: #e2e8f0; }
  h1 { color: #f8fafc; margin-bottom: 0.25rem; }
  h2 { color: #94a3b8; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2rem; }
  .health-banner { padding: 0.75rem 1.25rem; border-radius: 0.5rem; background: ${healthBg};
    color: white; font-weight: 600; margin: 1rem 0; display: inline-flex; align-items: center; gap: 0.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin-top: 0.5rem; }
  th { text-align: left; padding: 0.5rem 0.75rem; background: #1e293b; color: #94a3b8; font-weight: 500; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; }
  tr:hover td { background: #1e293b; }
  .badge { padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
  .badge.high   { background: #7f1d1d; color: #fca5a5; }
  .badge.medium { background: #78350f; color: #fcd34d; }
  .badge.low    { background: #14532d; color: #86efac; }
  pre { background: #1e293b; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.8rem; }
  .generated { color: #475569; font-size: 0.75rem; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Satori Capability Report</h1>
<div class="health-banner">${healthLabel}</div>
<p style="color:#94a3b8">${openFindings.length} finding(s) · ${openBacklog.length} backlog item(s) · ${metricsMap.size} capabilities tracked</p>

<h2>Capability Leaderboard</h2>
<table>
  <thead><tr><th>Capability</th><th>Invocations</th><th>Sessions</th><th>Downstream%</th><th>Success%</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<h2>Findings</h2>
${openFindings.length === 0 ? '<p style="color:#475569">No open findings.</p>' : `
<table>
  <thead><tr><th>Capability</th><th>Type</th><th>Severity</th><th>Summary</th></tr></thead>
  <tbody>${findingRows}</tbody>
</table>`}

<h2>Backlog</h2>
${openBacklog.length === 0 ? '<p style="color:#475569">No open backlog items.</p>' : `
<table>
  <thead><tr><th>Capability</th><th>Type</th><th>Title</th><th>Route</th><th>Confidence</th></tr></thead>
  <tbody>${backlogRows}</tbody>
</table>`}

<h2>Work-Style Summary</h2>
<pre>${escHtml(profileMd)}</pre>

<p class="generated">Generated by Satori at ${new Date().toISOString()}</p>
</body>
</html>`
}

function loadJsonl<T>(path: string, parseFn: (v: unknown) => T): T[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try { return [parseFn(JSON.parse(l))] }
    catch { return [] }
  })
}

function fmtRate(r: { shrunken: number; n: number } | null): string {
  return r ? `${(r.shrunken * 100).toFixed(0)}% (n=${r.n})` : '—'
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function severityOrder(s: string): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1
}

export function writeReport(metricsMap: Map<string, CapabilityMetrics>, outputPath: string): void {
  const dir = outputPath.split('/').slice(0, -1).join('/')
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(outputPath, generateReport(metricsMap))
}
```

- [ ] **Step 2: Typecheck**

Run: `cd claude-code/cli/src/satori && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add claude-code/cli/src/satori/src/report/html.ts
git commit -m "feat(satori): HTML report (RAG banner → leaderboard → findings → backlog → profile)"
```

---

### Task 5.2 — CLI commands

**Files:**
- Create: `claude-code/cli/src/satori/src/cli/commands/dream.ts`
- Create: `claude-code/cli/src/satori/src/cli/commands/profile.ts`
- Create: `claude-code/cli/src/satori/src/cli/commands/backlog.ts`
- Create: `claude-code/cli/src/satori/src/cli/commands/report.ts`
- Create: `claude-code/cli/src/satori/src/cli/commands/improve.ts`
- Create: `claude-code/cli/src/satori/src/cli/commands/mark.ts`
- Create: `claude-code/cli/src/satori/src/cli/commands/reset.ts`

- [ ] **Step 1: Create src/cli/commands/dream.ts**

```typescript
import { runDream } from '../../dream/dream.js'

export async function cmdDream(args: string[]): Promise<void> {
  const force = args.includes('--force')
  console.log('[satori] Starting dream pass...')
  const result = await runDream({ force })
  console.log(`[satori] Dream complete in ${result.durationMs}ms`)
  console.log(`  Events ingested:   ${result.eventsIngested}`)
  console.log(`  Capabilities:      ${result.metricsComputed}`)
  console.log(`  Intent clusters:   ${result.clustersFound}`)
}
```

- [ ] **Step 2: Create src/cli/commands/profile.ts**

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../../paths.js'

export function cmdProfile(args: string[]): void {
  const asJson = args.includes('--json')
  const file = asJson ? join(STATE_DIR, 'profile.json') : join(STATE_DIR, 'profile.md')
  if (!existsSync(file)) {
    console.error('[satori] No profile found. Run `satori dream` first.')
    process.exit(1)
  }
  process.stdout.write(readFileSync(file, 'utf8'))
}
```

- [ ] **Step 3: Create src/cli/commands/backlog.ts**

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../../paths.js'
import { BacklogItemSchema } from '../../types/projections.js'

export function cmdBacklog(args: string[]): void {
  const statusFilter = args.find(a => a.startsWith('--status='))?.split('=')[1] ?? 'open'
  const path = join(STATE_DIR, 'backlog.jsonl')
  if (!existsSync(path)) { console.log('[satori] No backlog yet. Run `satori dream` first.'); return }

  const items = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try { return [BacklogItemSchema.parse(JSON.parse(l))] } catch { return [] }
  }).filter(i => i.status === statusFilter)

  if (items.length === 0) { console.log(`No ${statusFilter} backlog items.`); return }
  for (const item of items.sort((a, b) => b.confidence - a.confidence)) {
    console.log(`[${item.item_id.slice(0, 8)}] ${item.type.padEnd(18)} ${item.title}`)
    console.log(`  capability: ${item.capability_id ?? '—'}  confidence: ${(item.confidence * 100).toFixed(0)}%  route: ${item.route}`)
    console.log(`  ${item.brief}`)
    console.log()
  }
}
```

- [ ] **Step 4: Create src/cli/commands/report.ts**

```typescript
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { STATE_DIR, CACHE_DIR } from '../../paths.js'
import { writeReport } from '../../report/html.js'
import { buildMetricProjections } from '../../dream/consolidate.js'
import { readEvents } from '../../store/event-log.js'
import { EVENTS_DIR } from '../../paths.js'

export async function cmdReport(args: string[]): Promise<void> {
  const serve = args.includes('--serve')
  const outPath = join(CACHE_DIR, 'report.html')

  // Rebuild metrics from event log for the report view
  const allEvents = []
  if (existsSync(EVENTS_DIR)) {
    const { readdirSync } = await import('fs')
    for (const date of readdirSync(EVENTS_DIR).sort()) {
      allEvents.push(...readEvents(date))
    }
  }
  const metrics = buildMetricProjections(allEvents, 1)
  writeReport(metrics, outPath)
  console.log(`[satori] Report written to ${outPath}`)

  if (serve) {
    const { spawn } = await import('child_process')
    const dir = CACHE_DIR
    const proc = spawn('python3', ['-m', 'http.server', '8787', '--directory', dir], { stdio: 'inherit' })
    console.log(`[satori] Serving at http://localhost:8787/report.html — Ctrl+C to stop`)
    await new Promise<void>(resolve => proc.on('close', resolve))
  }
}
```

- [ ] **Step 5: Create src/cli/commands/improve.ts**

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../../paths.js'
import { BacklogItemSchema } from '../../types/projections.js'

// Satori only produces the brief — never rewrites the capability itself.
// This command prints the brief for the given capability so the user can hand it to skill-creator.
export function cmdImprove(args: string[]): void {
  const capId = args[0]
  if (!capId) { console.error('Usage: satori improve <capability-id>'); process.exit(1) }

  const path = join(STATE_DIR, 'backlog.jsonl')
  if (!existsSync(path)) { console.error('[satori] No backlog found. Run `satori dream` first.'); process.exit(1) }

  const items = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try { return [BacklogItemSchema.parse(JSON.parse(l))] } catch { return [] }
  }).filter(i => i.capability_id === capId && i.status === 'open')

  if (items.length === 0) {
    console.log(`[satori] No open backlog items for capability: ${capId}`)
    return
  }

  for (const item of items) {
    console.log(`── ${item.type} (${item.item_id.slice(0, 8)}) ──`)
    console.log(`Title:  ${item.title}`)
    console.log(`Route:  ${item.route}`)
    console.log(`Brief:\n${item.brief}`)
    console.log()
  }
  console.log('[satori] Hand the brief above to `skill-creator` or `writing-skills`.')
  console.log(`         After applying, run: satori mark ${capId} accepted`)
}
```

- [ ] **Step 6: Create src/cli/commands/mark.ts**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../../paths.js'
import { BacklogItemSchema, type DecisionStatus } from '../../types/projections.js'

export function cmdMark(args: string[]): void {
  const [capId, rawStatus] = args
  if (!capId || !rawStatus) {
    console.error('Usage: satori mark <item-id-or-capability-id> accepted|rejected|superseded')
    process.exit(1)
  }
  const status = rawStatus as DecisionStatus
  const validStatuses: DecisionStatus[] = ['accepted', 'rejected', 'superseded', 'expired']
  if (!validStatuses.includes(status)) {
    console.error(`Invalid status: ${status}. Use one of: ${validStatuses.join(', ')}`)
    process.exit(1)
  }

  const path = join(STATE_DIR, 'backlog.jsonl')
  if (!existsSync(path)) { console.error('[satori] No backlog found.'); process.exit(1) }

  let updated = 0
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => {
    try {
      const item = BacklogItemSchema.parse(JSON.parse(l))
      if ((item.capability_id === capId || item.item_id === capId) && item.status === 'open') {
        updated++
        return JSON.stringify({ ...item, status })
      }
      return l
    } catch { return l }
  })
  writeFileSync(path, lines.join('\n') + '\n')
  console.log(`[satori] Marked ${updated} item(s) as ${status}.`)
}
```

- [ ] **Step 7: Create src/cli/commands/reset.ts**

```typescript
import { rmSync, existsSync, mkdirSync } from 'fs'
import { STATE_DIR, CACHE_DIR } from '../../paths.js'

export function cmdReset(args: string[]): void {
  const projectionsOnly = args.includes('--projections-only')

  if (existsSync(STATE_DIR)) {
    rmSync(STATE_DIR, { recursive: true })
    mkdirSync(STATE_DIR, { recursive: true })
    console.log('[satori] Cleared state/ (projections reset).')
  }
  if (!projectionsOnly && existsSync(CACHE_DIR)) {
    rmSync(CACHE_DIR, { recursive: true })
    mkdirSync(CACHE_DIR, { recursive: true })
    console.log('[satori] Cleared cache/ (SQLite index reset).')
  }
  console.log('[satori] Event log in events/ is untouched — projections will rebuild on next dream.')
}
```

- [ ] **Step 8: Commit**

```bash
git add claude-code/cli/src/satori/src/cli/commands/
git commit -m "feat(satori): CLI commands (dream, profile, backlog, report, improve, mark, reset)"
```

---

### Task 5.3 — CLI entry point (cli/index.ts)

**Files:**
- Create: `claude-code/cli/src/satori/src/cli/index.ts`

- [ ] **Step 1: Create src/cli/index.ts**

```typescript
#!/usr/bin/env bun
import { cmdDream }   from './commands/dream.js'
import { cmdProfile } from './commands/profile.js'
import { cmdBacklog } from './commands/backlog.js'
import { cmdReport }  from './commands/report.js'
import { cmdImprove } from './commands/improve.js'
import { cmdMark }    from './commands/mark.js'
import { cmdReset }   from './commands/reset.js'

const [,, subcommand, ...rest] = process.argv

const commands: Record<string, (args: string[]) => void | Promise<void>> = {
  dream:   cmdDream,
  profile: cmdProfile,
  backlog: cmdBacklog,
  report:  cmdReport,
  improve: cmdImprove,
  mark:    cmdMark,
  reset:   cmdReset,
}

if (!subcommand || subcommand === '--help' || subcommand === 'help') {
  console.log(`Satori (覚) — Capability analytics for Claude Code and friends

Usage: satori <command> [options]

Commands:
  dream    [--force]                  Run dream pass (collect + consolidate)
  profile  [--json]                   Print work-style profile
  backlog  [--status=open]            List improvement suggestions
  report   [--serve]                  Generate HTML report (--serve opens browser)
  improve  <capability-id>            Print brief for a backlog item
  mark     <id> accepted|rejected     Record outcome of an improvement
  reset    [--projections-only]       Clear state (event log preserved)
`)
  process.exit(0)
}

const handler = commands[subcommand]
if (!handler) {
  console.error(`Unknown command: ${subcommand}. Run \`satori help\` for usage.`)
  process.exit(1)
}

Promise.resolve(handler(rest)).catch(err => {
  console.error('[satori] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Make executable**

Run: `chmod +x claude-code/cli/src/satori/src/cli/index.ts`

- [ ] **Step 3: Smoke test CLI entry**

Run: `cd claude-code/cli/src/satori && bun run src/cli/index.ts help`
Expected: Usage banner printed, exit 0.

- [ ] **Step 4: Commit**

```bash
git add claude-code/cli/src/satori/src/cli/index.ts
git commit -m "feat(satori): CLI entry point with subcommand dispatch"
```

---

### Task 5.4 — Plugin slash commands + deprecated alias

**Files:**
- Create: `claude-code/plugins/satori/commands/satori.md`
- Modify: `claude-code/plugins/satori/commands/mekiki.md` (deprecation notice + forward)

- [ ] **Step 1: Create commands/satori.md**

```markdown
# /satori

Satori (覚) — capability analytics and improvement suggestions for your Claude Code sessions.

## Actions

- `dream` or no arg → runs `satori dream`, then shows profile summary
- `profile` → prints current work-style profile
- `backlog [--status=open]` → lists open improvement suggestions
- `report` → generates and serves the HTML report
- `improve <capability-id>` → shows improvement brief for handoff to skill-creator
- `mark <id> accepted|rejected` → records outcome after applying an improvement

## Steps

1. Parse the subcommand from the argument (default: `dream`).
2. Shell out: `bun run ~/.friday/satori/src/cli/index.ts <subcommand> [args]`
   - If the CLI is not installed, print: "Satori not installed. Run `claude-code/scripts/bootstrap.sh` first."
3. For `dream`: after completion, also run `profile` and print the first 20 lines.
4. For `improve`: after printing the brief, invoke `Skill(skill-creator)` or `Skill(writing-skills)`
   with the brief as context. Never rewrite the capability inline.
5. After the user applies or rejects an improvement, run `satori mark <id> accepted|rejected`.
```

- [ ] **Step 2: Update commands/mekiki.md (deprecated alias)**

Replace content of `commands/mekiki.md` with:
```markdown
# /mekiki (deprecated)

> **Deprecated.** `/mekiki` is the legacy name for Satori. This alias will be removed in the next release.
> Use `/satori` instead.

This command forwards to `/satori`. All arguments are passed through unchanged.

## Steps

1. Print: "⚠ /mekiki is deprecated — use /satori instead."
2. Forward to `/satori` with the same arguments.
```

- [ ] **Step 3: Commit**

```bash
git add claude-code/plugins/satori/commands/satori.md \
        claude-code/plugins/satori/commands/mekiki.md
git commit -m "feat(satori): /satori slash command + /mekiki deprecated alias"
```

---

### Task 5.5 — Stop hook integration + bootstrap update

**Files:**
- Modify: `claude-code/plugins/satori/hooks/stop.sh` (trigger dream pass)
- Modify: `claude-code/scripts/bootstrap.sh` (install satori CLI path)

- [ ] **Step 1: Update stop.sh to trigger dream pass**

Read `claude-code/plugins/satori/hooks/stop.sh`. Replace the body (or add after existing content) with a cadence-gated dream trigger:

```bash
#!/usr/bin/env bash
# stop.sh — fired on CC Stop hook; triggers a dream pass if cadence allows

SATORI_HOME="${HOME}/.satori"
DREAM_LOCK="${SATORI_HOME}/.dream.lock"
LAST_DREAM_FILE="${SATORI_HOME}/.last_dream"
CLI_PATH_FILE="${SATORI_HOME}/cli-path"
INTERVAL_HOURS="${SATORI_DREAM_INTERVAL_HOURS:-24}"

# Skip if another dream pass is running
if ! flock -x -n "${DREAM_LOCK}" true 2>/dev/null; then
  exit 0
fi

# Check cadence: skip if last dream was < INTERVAL_HOURS ago
if [[ -f "${LAST_DREAM_FILE}" ]]; then
  last=$(cat "${LAST_DREAM_FILE}")
  now=$(date +%s)
  elapsed=$(( (now - last) / 3600 ))
  if [[ "${elapsed}" -lt "${INTERVAL_HOURS}" ]]; then
    exit 0
  fi
fi

# Find CLI
if [[ ! -f "${CLI_PATH_FILE}" ]]; then exit 0; fi
CLI_RUNNER=$(cat "${CLI_PATH_FILE}")
if [[ ! -x "${CLI_RUNNER}" && ! -f "${CLI_RUNNER}" ]]; then exit 0; fi

# Run dream pass in background
date +%s > "${LAST_DREAM_FILE}"
flock -x "${DREAM_LOCK}" "${CLI_RUNNER}" dream &>/dev/null &
```

- [ ] **Step 2: Update bootstrap.sh to write CLI path**

Find the section in `claude-code/scripts/bootstrap.sh` that installs the mekiki CLI (around line 97-106). Replace with the Satori TS/Bun install:

```bash
# ── Satori CLI (TS/Bun) ──────────────────────────────────────────────────────
if confirm "Install Satori CLI engine (bun install)?"; then
  if command -v bun >/dev/null 2>&1; then
    SATORI_SRC="$REPO/cli/src/satori"
    ( cd "$SATORI_SRC" && bun install )
    mkdir -p "$HOME/.satori"
    echo "bun run $SATORI_SRC/src/cli/index.ts" > "$HOME/.satori/cli-path"
    ok "Satori CLI installed → bun run $SATORI_SRC/src/cli/index.ts"
  else
    warn "bun not found — install bun (https://bun.sh), then re-run."
  fi
fi
```

- [ ] **Step 3: Verify bash syntax**

Run: `bash -n claude-code/plugins/satori/hooks/stop.sh`
Run: `bash -n claude-code/scripts/bootstrap.sh`
Expected: No output from either.

- [ ] **Step 4: Run full test suite**

Run: `cd claude-code/cli/src/satori && bun test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-code/plugins/satori/hooks/stop.sh \
        claude-code/scripts/bootstrap.sh
git commit -m "feat(satori): stop hook cadence-gated dream trigger + bootstrap Satori CLI install"
```

---

### Task 5.6 — Plugin directory rename (mekiki → satori)

> Do this last, after all hooks and commands are tested.

**Files:** Move `claude-code/plugins/satori/` → `claude-code/plugins/satori/`

- [ ] **Step 1: Rename directory**

```bash
git mv claude-code/plugins/satori claude-code/plugins/satori
```

- [ ] **Step 2: Update any repo-internal references to the old path**

Run: `grep -r 'plugins/satori' claude-code/ --include='*.json' --include='*.md' --include='*.sh' -l`

For each file returned, replace `plugins/satori` with `plugins/satori`. Typical files:
- `claude-code/config/CLAUDE.md` — active plugin blurb path
- `claude-code/README.md` — plugin reference
- Any marketplace.json or manifest entries

- [ ] **Step 3: Update live CLAUDE.md Active Plugins blurb**

In `~/.claude/CLAUDE.md`, find the Mekiki active-plugins line and update:
- Display name: `Satori(Capability Overseer)` (drop 目利き, use 覚)
- Path references: `~/.satori/events/` (not `~/.mekiki/events/`)
- Command: `/satori` (not `/mekiki`)

- [ ] **Step 4: Verify plugin is recognized**

Run: `ls claude-code/plugins/satori/.claude-plugin/plugin.json`
Expected: file exists.

Run: `grep '"name"' claude-code/plugins/satori/.claude-plugin/plugin.json`
Expected: `"name": "satori"`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(satori): rename plugin directory mekiki→satori, update all internal references"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by task |
|---|---|
| R1 — Event envelope versioning + transaction order | Task 0.3 (schemas) + Task 1.2 (event-log) + Task 3.6 (dream.ts manifest) |
| R2 — Checkpoint model (inode/size/mtime/prefix-hash/offset) | Task 1.3 |
| R3 — JSONL canonical + SQLite disposable cache | Task 1.2 (event-log) + Task 1.4 (sqlite-cache) |
| R4 — observability_level per event, metric floors | Task 0.3 (schema) + Task 4.1-4.2 (adapters use inferred) |
| R5 — Derive-at-collect, no raw args/text | Task 0.5 (skill_pre.sh args removed) + Task 2.4 (BM25 terms at collect) |
| R6 — Wilson CI, empirical-Bayes, min-sample | Task 2.2 |
| R7 — Zod for LLM outputs, patch-op dreaming | Task 0.4 (llm-contracts.ts) + Task 3.1 (patch-ops.ts) |
| R8 — Hook re-wire + bootstrap migration reversal | Task 0.5 + Task 0.6 |
| R9 — Profile faceting (md + json), HTML report contract | Task 3.5 (profile.ts) + Task 5.1 (html.ts) |
| R10/Q1 — Exact event schema | Task 0.3 |
| R10/Q2 — Codex inferred invocations | Task 4.1 |
| R10/Q3 — Transaction order on projection failure | Task 1.2 (events safe) + Task 3.6 (manifest) |
| R10/Q4 — Dream write allowlist | Task 3.6 (dream.ts writes only to ~/.satori/) |
| R10/Q5 — Legacy ~/.mekiki evidence disposition | Task 0.6 (archive, not migrate) |
| /satori slash command | Task 5.4 |
| /mekiki deprecated alias | Task 5.4 |
| Plugin rename mekiki→satori | Task 5.6 |
| CC adapter | Task 1.5 |
| Codex adapter | Task 4.1 |
| OpenCode adapter | Task 4.2 |
| 4-phase dream pass | Tasks 3.2-3.6 |
| Gap detection | Task 2.5 |
| Split-apply-combine grammar | Task 2.3 |
| HTML report (RAG banner, leaderboard, findings, backlog, profile) | Task 5.1 |

### Placeholder scan

No TBD, TODO, or "add appropriate handling" phrases present — all code blocks are complete.

### Type consistency check

- `CapabilityInvokedPayload` defined in Task 0.3 and exported (Step 5 of Task 1.5), used consistently in Tasks 2.1, 2.4, 3.4.
- `CapabilityMetrics` defined in `consolidate.ts` (Task 3.4), imported by `profile.ts` (Task 3.5), `html.ts` (Task 5.1), and `report.ts` (Task 5.2).
- `StateManifest` defined in `projections.ts` (Task 0.4), used in `orient.ts` (Task 3.2) and `dream.ts` (Task 3.6).
- `CheckpointMap` defined in `checkpoint.ts` (Task 1.3), used by all adapters and `dream.ts`.
- `PatchOp` defined in `llm-contracts.ts` (Task 0.4), used in `patch-ops.ts` (Task 3.1).

---

Plan complete and saved to `claude-code/docs/superpowers/plans/2026-06-17-satori-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast parallel iteration (`superpowers:subagent-driven-development`)

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints

Which approach?


