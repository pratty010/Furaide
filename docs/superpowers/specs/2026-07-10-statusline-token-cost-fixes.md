# Spec — Statusline token/cost accuracy & live-use fixes

> Durable record for the `harnesses/claude-code/config/statusline-command.sh` accuracy work.
> Split into **already-shipped** (Tracks A/B/C, merged — do NOT re-implement) and **outstanding** (Track D, not yet built).
> Working copy / rationale detail: the session plan file. Original build spec: `docs/superpowers/plans/2026-07-08-statusline-install-ux.md` (+ its 2026-07-09 addendum).

---

## Already shipped — do NOT re-implement

Merged into `dev` as `715620d` on 2026-07-10; real-sidecar `--recompute-all` executed. Recorded here for lineage only.

- **Track A — token/cost accuracy** (`9349d00`): dedup token accounting by `message.id` (naive per-line sum overcounted 2–4×, verified on real transcripts); boundary-safe incremental passes (`last_msg_id`/newline-complete cursor); subagent fallback lumps replaced by pending-retry entries; per-model token buckets; subagent cost estimate `$: total [sub]`; display reformat (`↑…⚡…/↓…[turn] [⫂ in/out]`, CTX loses `+turn`); `--recompute-all` migration; fixed a jq `capture()` empty-stream bug that dropped completion records.
- **Track B — docs accuracy** (`6b61461`): root + 3 harness dev-guides moved to `CLAUDE.md` with `AGENTS.md` pointer stubs; 6 stale facts fixed (installer path, Īdisu 8-stage pipeline, web-tools shipped, graphify self-flag, GOSHIN attribution, apply-patches cwd); koda persona note.
- **Track C — color/glyph polish** (`926a681`): Fable/Mythos orange model color; glyph-mode-aware token glyphs; `$` cost magnitude ramp (dim/yellow/orange/red at 5/25/50); nerd-mode branch glyph.

---

## Outstanding — Track D: post-merge live-use fixes (2026-07-10)

All in `harnesses/claude-code/config/statusline-command.sh` (+ its tests). **Executes directly on `dev` — no worktree** (small change). Commits via `hanko--git-seal`. Verified 2026-07-10 that all four are still unimplemented on `dev`.

### D1 — Cost resets on session close/reopen (bug)

`COST` is read from `.cost.total_cost_usd` at display time only (`statusline-command.sh:678`). Claude Code resets the payload's `cost.*` fields on resume — which is exactly why `_fold_metric` (base+last fold, sidecar-persisted) already exists for `total_duration_ms`/`total_api_duration_ms`. Cost was never folded.

Fix — reuse the existing `_fold_metric` machinery (integer-only, so fold in **cents**):
- In the sidecar duration-fold block: `RAW_COST_CENTS=$(awk -v c="$(_jq '.cost.total_cost_usd // 0')" 'BEGIN{printf "%d", c*100 + 0.5}')`; guard non-numeric → 0.
- Add a third nested fold, same pattern as the two existing: `_fold_metric "$RAW_COST_CENTS" base_cost_cents last_cost_cents` → `FOLDED_COST_CENTS`; adopt only on successful `_sidecar_save` (mirror duration semantics).
- Display: `COST=$(awk -v c="$FOLDED_COST_CENTS" 'BEGIN{printf "%.2f", c/100}')` replaces the direct payload read; the cost ramp (`COST_INT`) then keys off the folded value automatically. Fail-open path (no jq/session_id): keep the raw payload read.
- `--recompute-all`: cost is NOT recomputable from transcripts (no per-message cost exists). Recompute must PRESERVE `base_cost_cents`/`last_cost_cents` from an existing sidecar (it already preserves duration keys via the `. +` merge — verify cost keys survive identically).
- **Regression test:** two `_run` invocations, second with a payload whose `total_cost_usd` is LOWER than the first (simulated resume reset) → displayed `$:` equals first + second, not the raw second value.

### D2 — Clock/API segment spacing (cosmetic, exact spec)

Current render (`:567`): `🕐 9h56m (📡2h58m)` — space before `(`, none after the glyph. Target: `🕐 9h56m(📡 2h58m)`.
- L1L assembly: drop the leading space in ` ${DIM}(${PG}…` → `${DIM}(${PG}…`, and move the space INTO the glyph var: `PG="📡 "` (emoji), nerd `' '` (trailing space), text `""` → text renders `(2h58m)` with no stray space.
- Header-comment format doc (`:7`, `:546`) → `🕐 dur(📡 api-dur)`.

### D3 — Cache-hit % becomes average of per-turn read rates (whole-session: main + subagents)

Today `⚡%` = cumulative `READ_TOTAL / GRAND_TOTAL_IN` (`:622`) — token-weighted, huge turns dominate. Requested: unweighted mean of each turn's own rate, still displayed as `⚡N%`.

Trackable because `_scan_usage_stdin` already walks every deduped message:
- Scan emits two new fields: `rate_sum` (Σ over deduped, non-boundary-duplicate turns of `cr/(in+cr+cc)`; skip turns with denominator 0) and `rate_turns` (count of contributing turns). Boundary-duplicate records (id == prev_msg_id) contribute 0/0 — their rate was fully counted the pass that first saw them (in/cr/cc identical across an id's lines).
- Sidecar main-thread: accumulate `.rate_sum` (float, jq-native) and `.rate_turns` via the existing delta-merge jq (bash never does the float math).
- Subagent entries (tail-pass, pending-retry, AND `--recompute-all` construction — all three build the same entry shape): add `rate_sum`/`rate_turns` from that agent's scan.
- Display: `READ_PCT` computed in one jq over `SIDECAR_JSON`: `floor(100 * (main rate_sum + Σ done-subagent rate_sum) / (main rate_turns + Σ done-subagent rate_turns))`; omit `⚡` when total turns or sum is 0. Fallback path (TAIL_OK≠1): keep the old cumulative payload-based ratio (no turn data there).
- Legacy sidecars lacking the keys: `// 0` defaults → `⚡` hides until new turns arrive or `--recompute-all` re-runs (rebuilds rates for all history).
- **Tests:** re-derive existing `⚡N%` expectations by hand per fixture; add a fixture where average and cumulative visibly diverge (one huge 0%-cache turn + two small 100%-cache turns → cumulative ≈ low single digits, average = 66%) asserting the average shows.

### D4 — Subagent cost shown as % of total, not dollars

`$: 5.22 [2.34]` → `$: 5.22 [45%]` (`:750`). Reads as "how much of the spend went to subagents."
- Keep computing `SUB_COST` (dollars, internal) exactly as today; display becomes `floor(SUB_COST * 100 / FOLDED_COST)` — denominator is the D1-folded total (dollars, from cents/100).
- Omit the bracket when total cost is 0 or SUB_COST is 0/empty (no div-by-zero, no meaningless `[0%]`).
- SUB_COST is an independent estimate vs the harness total: the % can legitimately exceed 100 in edge cases — display the raw floor, comment why no clamp.
- Percent math in awk: `awk -v s="$SUB_COST" -v t="$COST" 'BEGIN{ if (t+0 > 0) printf "%d", (s*100)/t }'`.
- Update the Test 9 pricing assertion (`[7.00]` → a `[N%]` given its payload total; pick a payload total making it clean, e.g. total 14.00 → `[50%]`).

### Track D verification

1. 3 statusline suites green (updated `⚡` expectations, D1 regression test, D3 divergence fixture, D4 `%` assertion).
2. Manual: render once, re-render same session with a reset-cost payload → cost accumulates. Glyph check `🕐 …(📡 …)` in emoji/nerd; `(…)` clean in text. Cost bracket renders `[N%]`.
3. `--recompute-all` on a scratch dir → sidecars carry `rate_sum`/`rate_turns` and preserve `base_cost_cents`; follow-up real run refreshes live sidecars.
4. `hanko--git-seal` commits directly on `dev` (no worktree, no push).
