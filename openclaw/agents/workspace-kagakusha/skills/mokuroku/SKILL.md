---
name: mokuroku
description: Topic-card report catalog with newest-first inventory, distillation state visibility, and detailed brief cards.
user-invocable: true
metadata: {"openclaw":{"emoji":"📚"}}
---

# Mokuroku (目録) - Report Catalog

Present stored reports by topic card first. On request, return a detailed topic report card.

## Data Source

- Primary index: `reports/index.json` (schema v2 cards object + `distilled` state).
- Filesystem source of truth for report files: `reports/YYYY-MM-DD/*.md`.
- Card key (`cards.<key>`) is the canonical topic identifier.

## Preflight Consistency Check (Mandatory)

Before inventory or topic-detail output, run this check:

1. Count total report markdown files in `reports/YYYY-MM-DD/*.md` (exclude scratch and non-report files).
2. Count total indexed report paths across `reports/index.json.cards.*.variants.sokkou[]` and `variants.kensho[]`.
3. Compute missing-in-index files:
   - files present on disk but not present in any index variant path.
4. If missing files exist, update `reports/index.json` before rendering output:
   - create/update card entries using existing canonical card-key rules
   - append missing variant records under `sokkou` or `kensho` based on filename suffix `(Deep Dive)`
   - update `coverage`, `reportDate`, `latestConfidence` (if inferable), and `generatedAt`
   - preserve existing non-deprecated fields and maintain schema v2
5. Recompute counts after repair and include a short reconciliation note in output.

## Rendering Profiles (Channel-Aware)

Select rendering profile by output destination metadata when available:

1. `discord` profile:
   - compact bullet layout
   - no markdown tables
   - short lines and chunk output if too long
2. `webchat` profile:
   - richer markdown allowed
   - optional table-like structure when it improves readability
3. fallback profile:
   - plain structured bullets

Deterministic behavior for all profiles:

- keep sort order deterministic (newest `reportDate` first)
- keep field order deterministic
- keep labels stable between runs

## Mode A - Inventory First (default)

1. Run mandatory preflight consistency check and index repair.
2. Read `reports/index.json` and sort cards by `reportDate` descending.
3. Show one row per topic card with:
   - coverage badges (`S` for sokkou, `D` for kensho)
   - topic
   - card key
   - reportDate
   - latest confidence
   - variant count (computed at runtime: `variants.sokkou.length + variants.kensho.length`)
   - distilled status (`true|false`)
4. Render according to selected channel profile.

## Mode B - Topic Requested

If user provides card key, title, or path, resolve in this order:

1. exact card key (`cards.<key>`)
2. exact topic title
3. fuzzy topic title
4. report path lookup across `variants.sokkou[].path` and `variants.kensho[].path`
5. if multiple matches remain, show disambiguation

Return a detailed topic report card containing:

- topic
- card key
- reportDate
- latest summary
- available variants and file paths
- confidence, source counts, and word counts per variant
- distillation state (`status`, `distilledAt`)
- quick diff (instant focus vs deep focus)
- tags and open questions (if present)
- index-vs-filesystem mismatch warnings (if any)

Render detail card according to selected channel profile.

## Reconciliation Rules (Index vs Filesystem)

1. For each variant path in index, verify file exists.
2. For report files present on disk but missing from index, repair index first, then surface a brief repair note.
3. For missing files referenced by index, surface warning (do not fabricate paths).
4. This skill may mutate `reports/index.json` only for missing-on-disk-to-index reconciliation.
5. Never mutate report markdown files.

## Distillation Display Rules

- Canonical state is two-value only:
  - `true`: fully distilled
  - `false`: not fully distilled
- Legacy values (for example `partial` or string drift) should be displayed as `false` with warning.

## Constraints

- No web calls.
- No subagents.
- Allowed write target for reconciliation: `reports/index.json` only.

## Output Quality

- Inventory-first always.
- When specific topic requested, prioritize actionable metadata over prose.
- Choose rendering style that fits destination channel readability requirements.
