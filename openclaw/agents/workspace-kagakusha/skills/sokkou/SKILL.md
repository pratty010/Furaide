---
name: sokkou
description: Fast instant research with memory-first recall, strict 2-search budget, and topic-card report output.
user-invocable: true
metadata: {"openclaw":{"emoji":"⚡"}}
---

# Sokkou (速攻) - Instant Report

Generate an informative, easy-to-read instant report in 1-2 page equivalent length.

## Hard Limits

- Always start by switching runtime to the Preferred model.
- Context retrieval order is strict:
  1. `RESEARCH_NOTES.md`
  2. `reports/index.json`
- Do not read `reports/**/*.md` for `sokkou` context building.
- Max `web_search` calls: 2 total.
- Max results requested per `web_search`: 10.
- Use `web_fetch` only to strengthen citations.
- No research subagents.
- Exactly one helper subagent is allowed only for `kensaku-kaizen` planning.
- Provide user progress updates across full orchestration with a max 30-second gap.

## Model Policy

- Preferred model: `google/gemini-2.5-flash`.
- Fallback: `google/gemini-2.5-flash-lite`.
- After completion (success or failure), restore agent default model via `session_status(model="default")`.

## Report Length Contract

- Target range: 700-1200 words.
- If draft exceeds 1200 words, compress lowest-priority material before saving.
- If draft is below 700 words, expand analysis and source-grounded context without adding fluff.

## Mandatory Section Order

1. Title line
2. Report Meta (Date, Mode, Confidence, Card Key)
3. BLUF (3-5 sentences)
4. Key Findings (5-8 bullets, each cited)
5. Concise Analysis (2-4 short paragraphs)
6. What Changed Since Prior Report (optional, max 3 bullets)
7. Sources (numbered, URL-forward)

## Orchestration Flow

1. Switch runtime to `Preferred` model (`google/gemini-2.5-flash`) and send status update.
2. Run `memory_search` on user query and close variants, prioritizing:
   - `RESEARCH_NOTES.md`
   - `reports/index.json`
   Send status update.
3. Resolve card key by canonical slug normalization and send status update.
4. Build context only from notes + index (no report file reads) and send status update.
5. Spawn helper subagent for `kensaku-kaizen` using `sessions_spawn` with:
   - `tool: sessions_spawn`
   - `label: "kensaku-kaizen-sokkou"`
   - `runTimeoutSeconds: 120`
   - `cleanup: "delete"`
   - task payload containing `mode=sokkou` and topic context
   Send status update before spawn and after completion.
6. If helper subagent fails or returns unusable queries, fallback to deterministic two-query set (one broad, one targeted), and continue with warning update.
7. Execute up to 2 `web_search` calls from optimized queries (request up to 10 results each). Send status update after each search batch.
8. Use selective `web_fetch` for top sources when needed. Send status update.
9. Call `hokoku-sakusei` to:
   - write report to `reports/YYYY-MM-DD/<Title>.md`
   - upsert topic card in `reports/index.json`
   Send status update.
10. Return an informative summary blob with:
   - key findings
   - confidence statement
   - report path
   - next-action options:
     - A: show full report
     - B: trigger `kensho` skill for further deep research
     - C: do nothing
11. If user chooses option B, collect optional feedback and pass it as handoff context to `kensho` skill with original query. In this case, **you can igonre** point 12. Follow the `kensho` skill instructions instead.
12. Always attempt model reset via `session_status(model="default")` after user-facing output. If reset fails, include explicit warning.

## Handoff Contract (`sokkou` -> `kensho`)

- `handoff_from_sokkou.topic`
- `handoff_from_sokkou.summary`
- `handoff_from_sokkou.feedback` (optional, empty if none)
- `handoff_from_sokkou.report_path`

## Storage and Naming Rules

- Date folder format: `YYYY-MM-DD` (IST).
- Instant filename: `<Topic Title>.md`.
- Sanitize only forbidden filesystem characters.

## Guardrails

- Every material claim must be cited.
- Explicitly state uncertainty when confidence is not high.
- Do not exceed search budget.

## Failure Finalization

- If unrecoverable failure occurs, return:
  - failure reason category (`tool_failure`, `source_failure`, `budget_limit`, `synthesis_failure`, or `input_ambiguity`)
  - concise root-cause summary
  - recovery hint for next attempt
- Even on failure, attempt `session_status(model="default")` and report reset outcome.

## Edge Cases

1. Missing or low-signal notes/index context: continue with web-only evidence and lower confidence if needed.
2. Empty/invalid query plan from helper subagent: fallback to one broad + one targeted deterministic query.
3. User selects "do nothing": stop without triggering additional workflows.
4. User selects `/kensho` without feedback: pass empty feedback field in handoff payload.
5. If `sessions_spawn` helper times out at 120s, continue with fallback queries and warning update.
