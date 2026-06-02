# Brand Builder CHANGELOG

## v2.0.0 (2026-06-02)

### What changed
- Plugin tools: 22 `bb_` tools wrapping all engines deterministically
- Hooks: approval-before-mutation, routing guard, prerequisite gates, auto-embed, run_log audit
- Logic: deterministic input-assembly in assessment, score provenance on all engines
- Semantic retrieval: pluggable embedding providers (transformers/ollama/gemini), sqlite-vec KNN
- Agents/skills/commands: all rewritten against BB-BRIEF/BB-RESULT contracts
- Schema: 10 tables (+ embedding_config = 11 total)
- Calibration harness: anchor-weak/mid/strong fixtures with score-band regression tests
- JD thin-text detection in `bb_parse_jd`: rejects < 50-word fetched pages and escalates to browser tier

### What was preserved
- 7 deterministic scoring engines (no scoring math changes)
- SQLite memory architecture (8 original tables extended)
- 246 original tests (all pass)
