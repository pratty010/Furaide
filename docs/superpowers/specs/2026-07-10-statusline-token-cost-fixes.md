# Spec — Statusline token/cost accuracy & live-use fixes

> Durable record for the `harnesses/claude-code/config/statusline-command.sh` accuracy work.
> Tracks A/B/C/D/E are all shipped. Nothing outstanding as of 2026-07-10.
> Working copy / rationale detail: the session plan file. Original build spec: `docs/superpowers/plans/2026-07-08-statusline-install-ux.md` (+ its 2026-07-09 addendum).

---

## Already shipped — do NOT re-implement

Merged into `dev` on 2026-07-10. Recorded here for lineage only.

- **Track A — token/cost accuracy** (`9349d00`): dedup token accounting by `message.id` (naive per-line sum overcounted 2–4×, verified on real transcripts); boundary-safe incremental passes (`last_msg_id`/newline-complete cursor); subagent fallback lumps replaced by pending-retry entries; per-model token buckets; subagent cost estimate `$: total [sub]`; display reformat (`↑…⚡…/↓…[turn] [⫂ in/out]`, CTX loses `+turn`); `--recompute-all` migration; fixed a jq `capture()` empty-stream bug that dropped completion records.
- **Track B — docs accuracy** (`6b61461`): root + 3 harness dev-guides moved to `CLAUDE.md` with `AGENTS.md` pointer stubs; 6 stale facts fixed (installer path, Īdisu 8-stage pipeline, web-tools shipped, graphify self-flag, GOSHIN attribution, apply-patches cwd); koda persona note.
- **Track C — color/glyph polish** (`926a681`): Fable/Mythos orange model color; glyph-mode-aware token glyphs; `$` cost magnitude ramp (dim/yellow/orange/red at 5/25/50); nerd-mode branch glyph.
- **Track D — post-merge live-use fixes** (`2738b46`): cost folds in cents via `_fold_metric` (resume-reset safe, adopt-on-successful-save, `--recompute-all` preserves the keys); clock/API spacing `🕐 dur(📡 api-dur)` across emoji/nerd/text; `⚡%` becomes unweighted average of per-turn read rates (jq-float-native `rate_sum`/`rate_turns` in sidecar + all three subagent entry builders, divergence fixture proves avg≠cumulative); subagent cost shown as `[N%]` of folded total (no clamp). 3 statusline suites green (18 + 25 + 57 = 100). A real-sidecar `--recompute-all` was run after the merge.
- **Track E — pricing-data-file + cost-estimate + sidecar-space + research** (2026-07-10, committed directly on `dev`, no worktree): all of E1-E6 below, implemented and verified. **`~est(n)` note** (answering the question that kicked off this pass): that display segment predates Track E entirely — it's Track A/D's existing pending-subagent estimate marker (confirmed zero-diff against `2738b46` on those lines). Track E's `estimated_cost_cents` is a different, session-total field; unrelated to the per-subagent `~est(n)` marker. 4 statusline suites green (38 + 18 + 74 + 25 = 155, up from the 100 baseline + the 35-assertion `test_pricing.sh` file that already existed uncommitted with 5 failing tests). Real-transcript sanity check: `--recompute-all` against all 10 real local sessions, no crashes, correct new sidecar schema, 136-subagent session shrank from 58KB to 3.9KB; live render against that session showed `$: 149.03 [34%]` (cost fell back to the E4 estimate, since that session was never rendered live with a real cost payload).

---

## Track E: pricing-data-file + cost-estimate + sidecar-space + research (2026-07-10) — SHIPPED, detail below for lineage

Follow-up surfaced by the 2026-07-10 transcript audit (`docs/research/claude-session-file-structure.md` is the durable reference). Two live-use problems + a completeness gap:

- **Space:** sidecars store a full `.subagents` map — one entry per subagent (done AND pending), each carrying its own `{in,out,cache_read,cache_creation,models:{...},rate_sum,rate_turns,done}`. For a 136-subagent session that's 58KB; only cumulative sums are ever read by the display.
- **Cost:** transcripts carry **zero** cost fields (`rg '"cost"|"total_cost"'` over all 386 transcripts → nothing); `total_cost_usd` exists only in the live hook payload. `--recompute-all` scans transcripts, so it cannot synthesize cost — it only preserves prior sidecar cost keys, which for never-rendered-live sessions are 0/absent.
- **Completeness:** the pricing source documents per-model cache prices, a `us` geo 1.1× multiplier, fast mode, and web-search billing — none represented in the shipped script's hardcoded table.

All in `harnesses/claude-code/config/` (+ tests). **Executed directly on `dev` — no worktree.** Committed via `hanko--git-seal`. E1 and E6 were already done as of the initial 2026-07-10 audit; E2-E5 were implemented in this pass.

### E1 — Pricing data file (authoritative source)

- **Create:** `harnesses/claude-code/config/claude-pricing.json` (shipped, read-only canonical source).
- **Global copy:** `~/.claude/claude-pricing.json`, written at install (mirrors how `statusline-command.sh` itself is shipped). **Ship + manual refresh** — updates ship via product releases; auto-refresh command is future work.
- **Source:** `https://platform.claude.com/docs/en/about-claude/pricing` (fetched 2026-07-10).
- **Schema** (per-MTok USD; multipliers STACK: cache tiers × inference_geo(us) × fast):
  - `models[<id>]`: `{in,out,cache_5m,cache_1h,cache_read}`. Opus 4.8/4.7 carry an extra `.fast:{in,out}`. Sonnet 5 carries `intro_until:"2026-08-31"` + an `.after:{...}` block for the Sep 1 cutover.
  - `families[<prefix>]`: fallback for unknown models (e.g. `claude-opus-4`, `claude-sonnet`, `claude-haiku`). **Family average only when exact model costing is unavailable.**
  - `default`: last-resort (`{3.0,15.0,3.75,6.0,0.30}` — sonnet tier).
  - `modifiers`: `inference_geo_us_multiplier:1.1`, `web_search_per_1000:10.0`, `web_fetch_per_1000:0.0`.
- **Script lookup order:** `CLAUDE_PRICING_FILE` env → `~/.claude/claude-pricing.json` → shipped `config/claude-pricing.json` → hardcoded in-script table (fail-open so the script never breaks if all files are absent).

### E2 — Externalize pricing + use all usage levels

- Replace the hardcoded `price($m)` jq function with a lookup into the loaded JSON. **Lookup order in jq:** exact `models[$m]` → longest `families` prefix → `default`. Date-aware Sonnet 5: if `today > intro_until`, use `.after`.
- `bcost` uses the **explicit per-model** `cache_5m`/`cache_1h`/`cache_read` prices (not the 1.25×/2×/0.1× derived multipliers) — direct authoritative values from the pricing page.
- **Modes (geo/speed) — session-level approximation:** pre-scan the session: if ANY message has `inference_geo:"us"`, apply `1.1×` to the whole session's token cost; if ANY has `speed:"fast"`, use `.fast` prices for opus tokens. Documented as a session-level approximation in the research report. No-op on current data (uniformly default), forward-compatible. Per-message exact bucketing is explicitly out of scope (2-4× bucket count for zero current benefit).

### E3 — Sidecar space: collapse `.subagents` to cumulative + pending-only

- **New sidecar schema** (drops the per-agent done map):
  - `subagent_in_total`/`_out_total`/`_cr_total`/`_cc_total` — cumulative confirmed subagent totals (display bracket).
  - `subagent_rate_sum`/`_rate_turns` — cumulative (D3 average).
  - `subagent_models` `{<model>:{in,out,cr,cc,cc_5m,cc_1h}}` — cumulative per-model (cost pricing).
  - `pending_subagents` `{<aid>:{fallback_estimate,model}}` — ONLY unresolved, retryable.
  - `counted_subagents` `[<aid>,…]` — guard against re-fold on cursor reset.
- **Script touch points** (completion handler, pending-retry, display sums L420-425, D3 rate L653-654, SUB_COST pricing L756-764, recompute L479): fold done entries into cumulative + `subagent_models` + append to `counted_subagents` + delete from `pending_subagents`; on no-file, set `pending_subagents[aid]`.
- **Migration** `_migrate_sidecar` (new, called after `_sidecar_load`): if old `.subagents` map present, fold done entries into cumulative+counted, move pending to `pending_subagents`, drop `.subagents` + legacy `subagent_fallback_tokens` (folded into cumulative during migration). Self-heals existing sidecars without a forced recompute.
- **Space win:** 136-entry session 58KB → ~3KB.

### E4 — Estimated cost from token buckets × pricing

- New `estimated_cost_cents` field = `bcost` over main `.models` + `subagent_models` + pending fallbacks + web_search (E5), × geo multiplier if applicable.
- **recompute** writes `estimated_cost_cents` (so the file shows a cost for every session).
- **live render** also writes/refreshes it.
- **Display:** `COST` = folded payload cost when non-zero (authoritative); **else** `estimated_cost_cents/100` (estimate). D4 `[N%]` denominator = same `COST`. No special marker (consistent with SUB_COST being an unlabeled estimate). Honest — same class of estimate as SUB_COST, the only available source since transcripts carry no cost.

### E5 — Scan captures web-search / web-fetch requests (1:1 with pricing page)

- `_scan_usage_stdin` emits `web_search` and `web_fetch` counts from `usage.server_tool_use.{web_search_requests,web_fetch_requests}` (deduped, boundary-duplicate-aware — same as the token fields).
- Sidecar accumulates `web_search_total`/`web_fetch_total`.
- Cost estimate factors `web_search_total × web_search_per_1000` (pricing-file modifier). `web_fetch` is $0 but tracked for symmetry/completeness.
- **0 across all 386 transcripts today** — future-complete, no display change (no noise when 0; a web-search glyph is a possible future enhancement, noted in the research report).

### E6 — Research report: Claude session-file structure

- **Create:** `docs/research/claude-session-file-structure.md` — durable reference for future features that parse these files. 11 sections: layout & location; record types; assistant record anatomy + dedup invariant; usage-object field census (billability flags); subagent transcript discovery + lifecycle; `<synthetic>` placeholders; cost-data absence; modes observed (geo/speed/service_tier, with counts); models observed (exact transcript id strings → pricing-file keys); pricing reference (file path/lookup, source URL, cutover dates, stacking multipliers, family-fallback rule); parser implications.
- **Status: built first** (this work item is already complete as of 2026-07-10; the file ships with the rest of Track E).

### Track E verification

1. 3 statusline suites green (updated sidecar-schema assertions for E3, pricing-lookup tests for E1/E2, cost-estimate hand-computed assertion for E4, web-search capture test for E5; keep D1–D4 green).
2. `--recompute-all` on a scratch dir → sidecars carry cumulative fields + `counted_subagents` + non-zero `estimated_cost_cents` for big sessions; file sizes drop; pricing file loads from shipped/global/env in priority order.
3. `bash -n` + `shellcheck` (no new warnings).
4. `hanko--git-seal` commits directly on `dev` (no worktree, no push).

---

## Appendix — Token-tracking 1:1 map (usage object → pricing category → scan field)

Authoritative pricing categories from `platform.claude.com/docs/en/about-claude/pricing` (fetched 2026-07-10) mapped to transcript `message.usage` fields and the scan's output fields. After Track E, all five token categories + web-search are tracked 1:1.

| Pricing category | `usage` field | Scan field | Per-MTok price source |
|---|---|---|---|
| Base Input Tokens | `input_tokens` | `in` | `models[$m].in` |
| 5m Cache Writes | `cache_creation.ephemeral_5m_input_tokens` | `cc_5m` | `models[$m].cache_5m` |
| 1h Cache Writes | `cache_creation.ephemeral_1h_input_tokens` | `cc_1h` | `models[$m].cache_1h` |
| Cache Hits & Refreshes | `cache_read_input_tokens` | `cr` | `models[$m].cache_read` |
| Output Tokens | `output_tokens` | `out` | `models[$m].out` |
| Web search (per 1k) | `server_tool_use.web_search_requests` | `web_search` *(E5)* | `modifiers.web_search_per_1000` |
| Web fetch (per 1k) | `server_tool_use.web_fetch_requests` | `web_fetch` *(E5)* | `modifiers.web_fetch_per_1000` |

**Dedup invariant (unchanged from Track A):** one JSONL line per content block of a single API response; every line repeats that response's usage snapshot. For a given `message.id`, `input_tokens`/`cache_read`/`cache_creation` are identical across all lines while `output_tokens` grows monotonically (last line == max). The scan takes last-per-id via `group_by(.message.id) | map(.[-1])`; boundary-duplicate records (id == `prev_msg_id`) contribute 0 to in/cr/cc/cc_5m/cc_1h/web_search (the prior pass already counted them) and only the output growth beyond `last_msg_out`.

**Documented approximation:** older transcripts lack the `cache_creation` sub-object and carry only flat `cache_creation_input_tokens`; the scan treats the whole value as 5m-tier (`cc_5m`), matching Anthropic's historical default. Not a bug — noted in the research report.

**Out of scope:** `code_execution_requests` (billed by container-hours, not tokens), `iterations`/`service_tier`/`inference_geo`/`speed` (uniformly default across all current transcripts; geo/speed handled at session-level approximation in E2, not per-message bucketing).
