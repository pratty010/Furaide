# Statusline Fixes + Install UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two statusline calculation bugs (API-wait shown as a runaway percentage instead of duration; cache-hit percentage overflowing past 1000% on long sessions), then overhaul the three harness installers (claude-code, opencode-fleet, pi-agent) so they share one predictable UX: a top-level picker, CWD walk-up scope detection, dual bun/npm support, in-target-dir backups, back-navigable wizards, and one shared skill pool at `~/.agents/skills/` that all three tools read (natively for OpenCode/Pi, via symlink for Claude Code).

**Architecture:** Statusline fix is a single-file bash change (`harnesses/claude-code/config/statusline-command.sh`) verified against its existing 3-suite bash test harness. Install UX spans a new shared bash library (`packages/cli/src/shared/install-lib.sh`) consumed by the claude-code and pi-agent installers (bash), plus targeted edits to the opencode-fleet installer (already a mature, zod-schema-validated TypeScript codebase — `packages/cli/src/targets/opencode-fleet/*.ts`) to align its backup/receipt naming and add scope walk-up + back-navigation. The top-level `furaide install|uninstall` picker lives in `packages/cli/src/router.ts`.

**Tech Stack:** bash (statusline, CC/Pi installers, shared lib), TypeScript + zod + `@clack/prompts` (opencode-fleet installer), Node `.mjs` (`pull-external-skills.mjs`), `jq`/`python3` (JSON manipulation in bash), existing plain-bash test harness (no `bats`).

**Naming (LOCKED — applies throughout):** Receipt filename is `.furaide-receipt.json` everywhere (opencode-fleet currently uses `.furaide-install-receipt.json` — renamed in Phase 6). Backup directory name is `.furaide-backup/<timestamp>/` everywhere (opencode-fleet currently uses `.kura_backup/` — renamed in Phase 6). Shared skill pool is `~/.agents/skills/` (already the source of truth for claude-code bundled skills via `install-vendored-skills.sh`; opencode-fleet's *external* skills currently land at `~/.config/opencode/skills/` instead — migrated in Phase 6).

**Plan structure (chunked mega-plan per this repo's convention — see `docs/superpowers/archive/plans/2026-07-06-idisu-v2.md`):**
- **Phase 1** — Statusline fixes (self-contained, TDD red-green against the existing 3-file test suite)
- **Phase 2** — Shared install library: JS runtime detection, in-target backup, CWD walk-up scope detection (new bash, consumed by Phases 4/5/8)
- **Phase 3** — Top-level harness picker (`scripts/install.sh`, `scripts/uninstall.sh`, `router.ts`)
- **Phase 4** — Claude Code installer rewrite (global + project scope, receipt, component multiselect)
- **Phase 5** — Claude Code uninstaller rewrite (receipt-driven, delete/skip semantics, symlink-only skill removal)
- **Phase 6** — OpenCode alignment (rename backup dir + receipt filename, walk-up scope default, unified skill model migration)
- **Phase 7** — OpenCode uninstall scope picker
- **Phase 8** — Pi Agent alignment (prereq checks, shared-skill note, uninstall path)
- **Phase 8.5** — Close remaining global-flag gaps (`--dry-run` for opencode-fleet, `--skip-checks` everywhere)
- **Phase 9** — Full-suite verification and final green check

Each phase produces working, testable software on its own. Commit after each task.

**Out of scope for this plan:** Documentation refresh (READMEs, CLAUDE.md, AGENTS.md content updates reflecting the new flows) — tracked as a follow-up plan to write after Phases 1–9 ship and land.

---

## Phase 1 — Statusline fixes

**Outcome:** `statusline-command.sh` shows API wait time as a duration (`📡 3s` / `📡 2m` / `📡 1h5m`) instead of an unbounded percentage, and the token segment shows a grand total across main-thread + subagent activity with a cache-hit percentage that is mathematically bounded to ≤100% (`↑73k ⚡99% /↓276`). All 3 existing test suites pass, with assertions updated to match the new format.

**Files:**
- Modify: `harnesses/claude-code/config/statusline-command.sh`
- Modify: `harnesses/claude-code/tests/statusline/test_display_v2.sh`
- Modify: `harnesses/claude-code/tests/statusline/test_transcript_tail.sh`
- Modify: `harnesses/claude-code/tests/statusline/test_sidecar_fold.sh` (no assertion changes needed — verify only)

### Task 1.1: Update test assertions to the new token/timing format (red)

The current tests assert the *old* format (`⚡3%` computed against fresh-input-only denominator, no sub-second duration). Update them first so they fail against the current implementation, confirming they exercise the new behavior once Task 1.2/1.3 land.

- [ ] **Step 1: Update `test_transcript_tail.sh` Test 1 assertions for grand-total token math**

The current Test 1 payload produces: main-thread `in=1500, out=300, cache_read=50, cache_creation=10`; subagent `sub_in=300, sub_out=150` (cache fields not yet captured — Task 1.3 adds this, but the test's `_subagent_transcript_line` call already passes cache values `20 0` as its 3rd/4th args to `_assistant_line`, so once Task 1.3 lands, the subagent's own cache_read=20 will also be summed).

New grand-total math after Task 1.3 lands:
- `grand_total_in = IN_TOTAL(1500) + CR_TOTAL(50) + CC_TOTAL(10) + SUB_IN_EFF(300) + SUB_CR_TOTAL(20) + SUB_CC_TOTAL(0) = 1880`
- `⚡r% = (CR_TOTAL(50) + SUB_CR_TOTAL(20)) * 100 / 1880 = 70*100/1880 = 3%` (integer division)
- `grand_total_out = OUT_TOTAL(300) + SUBAGENT_OUT_TOTAL(150) = 450`

In `harnesses/claude-code/tests/statusline/test_transcript_tail.sh`, replace lines 139–142:

```bash
_assert_contains "run1: main-thread in/out totals rendered (1500/300 -> 1k/300)" "$OUT1" "↑1k"
_assert_contains "run1: main-thread cache read% rendered (50/1500 -> 3%)" "$OUT1" "⚡3%"
_assert_contains "run1: main-thread out total rendered" "$OUT1" "↓300"
_assert_contains "run1: subagent share rendered (sub in=300,out=150 vs totals 1500/300)" "$OUT1" "[⑂16%/33%]"
```

with:

```bash
_assert_contains "run1: grand-total in rendered (1500+50+10+300+20+0=1880 -> 1k)" "$OUT1" "↑1k"
_assert_contains "run1: cache-hit% rendered ((50+20)*100/1880 -> 3%)" "$OUT1" "⚡3%"
_assert_contains "run1: grand-total out rendered (300+150=450)" "$OUT1" "↓450"
_assert_contains "run1: subagent share rendered (sub in=320 vs 1880; sub out=150 vs 450)" "$OUT1" "[⑂17%/33%]"
```

(`SUB_IN_EFF` for the `[⑂]` share is `sub_in(300) + sub_cr(20) + sub_cc(0) = 320`; wait — re-derive: per the locked spec, `[⑂in%]` denominator is `grand_total_in` and numerator is `SUB_IN_EFF` where `SUB_IN_EFF = SUBAGENT_IN_TOTAL + SUBAGENT_FALLBACK_TOTAL` (unchanged definition — it does NOT include subagent cache tokens, only `in`/`out` per-subagent are tracked for the share numerator, cache totals are added only to the grand *denominator*). So `IN_SHARE = 300 * 100 / 1880 = 15%` not 17%. Fix the assertion to `[⑂15%/33%]`. Use this exact value:)

```bash
_assert_contains "run1: subagent share rendered (sub_in=300 vs grand_total_in=1880; sub_out=150 vs grand_total_out=450)" "$OUT1" "[⑂15%/33%]"
```

- [ ] **Step 2: Update Test 2 (idempotency) assertions**

Replace lines 159–160:

```bash
_assert_contains "run2: totals unchanged (no new data)" "$OUT2" "↑1k"
_assert_contains "run2: subagent share unchanged (sub1 not double-counted)" "$OUT2" "[⑂16%/33%]"
```

with:

```bash
_assert_contains "run2: totals unchanged (no new data)" "$OUT2" "↑1k"
_assert_contains "run2: subagent share unchanged (sub1 not double-counted)" "$OUT2" "[⑂15%/33%]"
```

- [ ] **Step 3: Update Test 3 (new lines + fallback) assertions**

After Test 3's additional transcript lines, main-thread totals become `in=1700, out=350, cache_read=55, cache_creation=11`. Subagent sub1 unchanged (`in=300,out=150,cr=20,cc=0`); subagent sub2 falls back to lump-sum `fallback_tokens=777` (no cache split available in the fallback path — fallback stays `in`-only per existing fallback semantics, contributes 0 to cache totals).

`grand_total_in = 1700 + 55 + 11 + (300+777) + 20 + 0 = 2863`
`⚡r% = (55+20)*100/2863 = 75*100/2863 = 2%`
`grand_total_out = 350 + 150 = 500`
`SUB_IN_EFF = 300 + 777 = 1077` → `IN_SHARE = 1077*100/2863 = 37%`
`SUB_OUT_EFF = 150` → `OUT_SHARE = 150*100/500 = 30%`

Replace lines 177–179:

```bash
_assert_contains "run3: main-thread out total advanced (350)" "$OUT3" "↓350"
_assert_contains "run3: main-thread cache read% advanced (55/1700 -> 3%)" "$OUT3" "⚡3%"
_assert_contains "run3: subagent share advanced (sub1 in=300 + fallback=777 vs total 1700; sub_out=150 vs 350)" "$OUT3" "[⑂38%/30%]"
```

with:

```bash
_assert_contains "run3: grand-total out advanced (350+150=500)" "$OUT3" "↓500"
_assert_contains "run3: cache-hit% advanced ((55+20)*100/2863 -> 2%)" "$OUT3" "⚡2%"
_assert_contains "run3: subagent share advanced (sub_in=300+777=1077 vs grand_total_in=2863; sub_out=150 vs grand_total_out=500)" "$OUT3" "[⑂37%/30%]"
```

- [ ] **Step 4: Update Test 4 (fail-open, no transcript) — verify no change needed**

Test 4 (lines 190–207) falls back to `context_window` payload fields when the transcript is unreadable — this path is untouched by Task 1.3 (it doesn't go through the transcript tail pass at all, so no subagent/cache accounting applies). The existing assertion `_assert_contains "fail-open: token display falls back to context_window payload fields (1000/200 -> 1k/200)" "$OUT4" "↑1k"` stays correct as-is — no edit needed. Confirm by reading lines 200–207 of the file; do not modify.

- [ ] **Step 5: Run the transcript-tail suite to confirm it now fails (red)**

Run: `bash harnesses/claude-code/tests/statusline/test_transcript_tail.sh`
Expected: multiple `FAIL` lines for the assertions just changed (`↓450` not found because the script still renders `↓300`, etc.) — confirms the test now exercises the new behavior and the implementation hasn't changed yet.

- [ ] **Step 6: Commit the test updates**

```bash
git add harnesses/claude-code/tests/statusline/test_transcript_tail.sh
git commit -m "$(cat <<'EOF'
test(statusline): update token assertions for grand-total accounting

Why: the current cache-hit percentage divides by fresh-input-tokens
only, which is why long sessions render ⚡367220%. The fix (next
commit) sums all three Anthropic cache fields plus subagent totals
into one grand-total denominator. These assertions are updated first
(red) so the implementation commit can be verified against them.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Fix API-wait timing display (percentage → duration)

- [ ] **Step 1: Extend `_dur()` to support sub-minute durations**

In `harnesses/claude-code/config/statusline-command.sh`, the current `_dur()` (lines 80–84):

```bash
_dur() {  # ms -> compact h/m (e.g. 3900000 -> "1h5m", 2400000 -> "40m")
  local ms="${1:-0}" tot h m
  tot=$(( ms / 60000 )); h=$(( tot / 60 )); m=$(( tot % 60 ))
  if [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"; else printf '%dm' "$m"; fi
}
```

Replace with:

```bash
_dur() {  # ms -> compact h/m/s (e.g. 3900000 -> "1h5m", 2400000 -> "40m", 3000 -> "3s")
  local ms="${1:-0}" tot h m s
  if [ "$ms" -lt 60000 ]; then
    s=$(( ms / 1000 )); printf '%ds' "$s"; return
  fi
  tot=$(( ms / 60000 )); h=$(( tot / 60 )); m=$(( tot % 60 ))
  if [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"; else printf '%dm' "$m"; fi
}
```

- [ ] **Step 2: Replace the `API_PCT` percentage calc with a duration call**

Current (lines 369–377):

```bash
if [ "$DURATION_MS" -ge 60000 ]; then
  case "$GLYPHS" in emoji) CG="🕐 " ;; nerd) CG=$' ' ;; *) CG="" ;; esac
  L1L+=" ${DIM}│${RST} ${DIM}${CG}$(_dur "$DURATION_MS")${RST}"
  if [ "$DURATION_MS" -gt 0 ]; then
    API_PCT=$(( API_MS * 100 / DURATION_MS ))
    case "$GLYPHS" in emoji) PG="📡" ;; nerd) PG=$'' ;; *) PG="" ;; esac
    L1L+=" ${DIM}(${PG}${API_PCT}%)${RST}"
  fi
fi
```

Replace with:

```bash
if [ "$DURATION_MS" -ge 60000 ]; then
  case "$GLYPHS" in emoji) CG="🕐 " ;; nerd) CG=$' ' ;; *) CG="" ;; esac
  L1L+=" ${DIM}│${RST} ${DIM}${CG}$(_dur "$DURATION_MS")${RST}"
  if [ "$API_MS" -gt 0 ]; then
    case "$GLYPHS" in emoji) PG="📡" ;; nerd) PG=$'' ;; *) PG="" ;; esac
    L1L+=" ${DIM}(${PG}$(_dur "$API_MS"))${RST}"
  fi
fi
```

(The gate changes from `DURATION_MS -gt 0` to `API_MS -gt 0` — with the old percentage formula, `API_MS=0` naturally rendered `(📡0%)`, which was noise; showing the segment only when there is actual API wait time to report is strictly better and matches the "omit when zero" pattern used elsewhere in this script, e.g. the `[⑂]` segment.)

- [ ] **Step 3: Run the sidecar-fold suite to confirm the duration-only tests still pass**

Run: `bash harnesses/claude-code/tests/statusline/test_sidecar_fold.sh`
Expected: `=== Results: N passed, 0 failed ===` — this suite only asserts on the `🕐` clock segment (`13m`, `10m`, `5m`), which Step 2 didn't touch. No assertion changes were needed for this file per the plan header.

- [ ] **Step 4: Manual smoke test for the new `📡` duration format**

Run:
```bash
echo '{
  "session_id": "smoke-api-dur",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 300000, "total_api_duration_ms": 45000, "total_cost_usd": 1.0,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"total_input_tokens": 100, "total_output_tokens": 50,
                      "context_window_size": 200000, "current_usage": null},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}' | COLUMNS=120 STATUSLINE_STATE_DIR=/tmp/smoke-statusline bash harnesses/claude-code/config/statusline-command.sh
```
Expected: line 1 contains `🕐 5m (📡45s)` — 300000ms=5m duration, 45000ms=45s API wait, NOT a percentage.

- [ ] **Step 5: Commit**

```bash
git add harnesses/claude-code/config/statusline-command.sh
git commit -m "$(cat <<'EOF'
fix(statusline): show API wait as duration, not percentage

Why: (📡 0%) told the user nothing actionable — API_MS*100/DURATION_MS
is a fraction of session time, not a duration, and degenerates to 0%
for the common case of a mostly-idle session with real API latency.
_dur() now supports sub-minute output (Xs) so the segment reads as an
actual wait time: (📡 3s) / (📡 2m) / (📡 1h5m).

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: Fix token-overflow — grand-total accounting + subagent cache capture

- [ ] **Step 1: Capture subagent cache tokens instead of discarding them**

In `harnesses/claude-code/config/statusline-command.sh`, current line 261 (inside `_transcript_tail_pass`'s completion-record loop):

```bash
        if [ -r "$subfile" ] && sub_usage=$(_sum_assistant_usage_stdin < "$subfile" 2>/dev/null); then
          read -r sub_in sub_out _ _ <<<"$sub_usage"
          counted=1
        fi
```

Replace with:

```bash
        if [ -r "$subfile" ] && sub_usage=$(_sum_assistant_usage_stdin < "$subfile" 2>/dev/null); then
          read -r sub_in sub_out sub_cr sub_cc <<<"$sub_usage"
          counted=1
        fi
```

Two lines above this block, the local-variable declaration must gain the two new names. Current line 252:

```bash
        local aid ftok already sub_in=0 sub_out=0 counted=0 sub_usage subfile
```

Replace with:

```bash
        local aid ftok already sub_in=0 sub_out=0 sub_cr=0 sub_cc=0 counted=0 sub_usage subfile
```

- [ ] **Step 2: Store the subagent's cache fields in the sidecar**

Current line 266 (the `counted=1` branch that writes the per-subagent sidecar entry):

```bash
        if [ "$counted" -eq 1 ]; then
          SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson i "$sub_in" --argjson o "$sub_out" \
            '.subagents[$t] = {in: $i, out: $o, done: true}' 2>/dev/null) || continue
```

Replace with:

```bash
        if [ "$counted" -eq 1 ]; then
          SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson i "$sub_in" --argjson o "$sub_out" \
            --argjson cr "$sub_cr" --argjson cc "$sub_cc" \
            '.subagents[$t] = {in: $i, out: $o, cache_read: $cr, cache_creation: $cc, done: true}' 2>/dev/null) || continue
```

(The fallback-lump-sum branch a few lines below, which writes `{in: 0, out: 0, done: true}` when only the `<usage>` block's lump sum is available, is left unchanged — no cache split exists for that path, and `.cache_read`/`.cache_creation` will simply be absent from that entry, defaulting to 0 via `// 0` when summed in Step 3.)

- [ ] **Step 3: Sum subagent cache totals from the sidecar**

Current lines 282–285 (end of `_transcript_tail_pass`, where `SUBAGENT_IN_TOTAL`/`SUBAGENT_OUT_TOTAL` are computed):

```bash
  SUBAGENT_IN_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.in // 0] | add // 0' 2>/dev/null)
  SUBAGENT_OUT_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.out // 0] | add // 0' 2>/dev/null)
  case "$SUBAGENT_IN_TOTAL" in ''|*[!0-9]*) SUBAGENT_IN_TOTAL=0 ;; esac
  case "$SUBAGENT_OUT_TOTAL" in ''|*[!0-9]*) SUBAGENT_OUT_TOTAL=0 ;; esac
  return 0
}
```

Replace with:

```bash
  SUBAGENT_IN_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.in // 0] | add // 0' 2>/dev/null)
  SUBAGENT_OUT_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.out // 0] | add // 0' 2>/dev/null)
  SUBAGENT_CR_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.cache_read // 0] | add // 0' 2>/dev/null)
  SUBAGENT_CC_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.cache_creation // 0] | add // 0' 2>/dev/null)
  case "$SUBAGENT_IN_TOTAL" in ''|*[!0-9]*) SUBAGENT_IN_TOTAL=0 ;; esac
  case "$SUBAGENT_OUT_TOTAL" in ''|*[!0-9]*) SUBAGENT_OUT_TOTAL=0 ;; esac
  case "$SUBAGENT_CR_TOTAL" in ''|*[!0-9]*) SUBAGENT_CR_TOTAL=0 ;; esac
  case "$SUBAGENT_CC_TOTAL" in ''|*[!0-9]*) SUBAGENT_CC_TOTAL=0 ;; esac
  return 0
}
```

- [ ] **Step 4: Initialize the two new globals alongside the existing subagent globals**

Current line 315 (right before the `_transcript_tail_pass` call site):

```bash
SUBAGENT_IN_TOTAL=0; SUBAGENT_OUT_TOTAL=0; SUBAGENT_FALLBACK_TOTAL=0
```

Replace with:

```bash
SUBAGENT_IN_TOTAL=0; SUBAGENT_OUT_TOTAL=0; SUBAGENT_FALLBACK_TOTAL=0
SUBAGENT_CR_TOTAL=0; SUBAGENT_CC_TOTAL=0
```

- [ ] **Step 5: Replace the token-string construction with grand-total accounting**

Current lines 383–401 (Line 1 RIGHT token section):

```bash
DISPLAY_IN="$IN_TOTAL"; DISPLAY_OUT="$OUT_TOTAL"
DISPLAY_CR="$CACHE_READ_TOTAL"; DISPLAY_CC="$CACHE_CREATION_TOTAL"
if [ "$TAIL_OK" -ne 1 ]; then
  DISPLAY_IN=$(_jq_int '.context_window.total_input_tokens')
  DISPLAY_OUT=$(_jq_int '.context_window.total_output_tokens')
  DISPLAY_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
  DISPLAY_CC=0
fi
IN_STR="${GRN}↑$(_human "$DISPLAY_IN")${RST}"
if [ "$DISPLAY_IN" -gt 0 ] && [ "$DISPLAY_CR" -gt 0 ]; then
  READ_PCT=$(( DISPLAY_CR * 100 / DISPLAY_IN ))
  IN_STR="${IN_STR}${DIM}⚡${READ_PCT}%${RST}"
fi
OUT_STR="${BLU}↓$(_human "$DISPLAY_OUT")${RST}"
if [ "$DISPLAY_IN" -gt 0 ] && [ "$DISPLAY_CC" -gt 0 ]; then
  WRITE_PCT=$(( DISPLAY_CC * 100 / DISPLAY_IN ))
  OUT_STR="${OUT_STR}${DIM}⚡${WRITE_PCT}%${RST}"
fi
TOK="${IN_STR}/${OUT_STR}"
```

Replace with:

```bash
DISPLAY_IN="$IN_TOTAL"; DISPLAY_OUT="$OUT_TOTAL"
DISPLAY_CR="$CACHE_READ_TOTAL"; DISPLAY_CC="$CACHE_CREATION_TOTAL"
DISPLAY_SUB_IN=$(( SUBAGENT_IN_TOTAL + SUBAGENT_FALLBACK_TOTAL ))
DISPLAY_SUB_OUT="$SUBAGENT_OUT_TOTAL"
DISPLAY_SUB_CR="$SUBAGENT_CR_TOTAL"; DISPLAY_SUB_CC="$SUBAGENT_CC_TOTAL"
if [ "$TAIL_OK" -ne 1 ]; then
  DISPLAY_IN=$(_jq_int '.context_window.total_input_tokens')
  DISPLAY_OUT=$(_jq_int '.context_window.total_output_tokens')
  DISPLAY_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
  DISPLAY_CC=0
  DISPLAY_SUB_IN=0; DISPLAY_SUB_OUT=0; DISPLAY_SUB_CR=0; DISPLAY_SUB_CC=0
fi
GRAND_TOTAL_IN=$(( DISPLAY_IN + DISPLAY_CR + DISPLAY_CC + DISPLAY_SUB_IN + DISPLAY_SUB_CR + DISPLAY_SUB_CC ))
GRAND_TOTAL_OUT=$(( DISPLAY_OUT + DISPLAY_SUB_OUT ))
IN_STR="${GRN}↑$(_human "$GRAND_TOTAL_IN")${RST}"
READ_TOTAL=$(( DISPLAY_CR + DISPLAY_SUB_CR ))
if [ "$GRAND_TOTAL_IN" -gt 0 ] && [ "$READ_TOTAL" -gt 0 ]; then
  READ_PCT=$(( READ_TOTAL * 100 / GRAND_TOTAL_IN ))
  IN_STR="${IN_STR} ${DIM}⚡${READ_PCT}%${RST}"
fi
OUT_STR="${BLU}↓$(_human "$GRAND_TOTAL_OUT")${RST}"
TOK="${IN_STR} ${DIM}/${RST}${OUT_STR}"
```

(Cache-write rate is intentionally not displayed — per the locked design, it is implicit in the grand total; only the read/cache-hit rate `⚡r%` is shown, always bounded to ≤100% because both numerator and denominator now include the same cache fields.)

- [ ] **Step 6: Update the `[⑂]` subagent-share denominators to grand totals**

Current lines 403–416:

```bash
SUB_IN_EFF=$(( SUBAGENT_IN_TOTAL + SUBAGENT_FALLBACK_TOTAL ))
SUB_OUT_EFF="$SUBAGENT_OUT_TOTAL"
SUB_SEG=""
if [ "$SUB_IN_EFF" -gt 0 ] || [ "$SUB_OUT_EFF" -gt 0 ]; then
  IN_SHARE_DEN=$(( DISPLAY_IN + SUB_IN_EFF )); IN_SHARE=0
  [ "$IN_SHARE_DEN" -gt 0 ] && IN_SHARE=$(( SUB_IN_EFF * 100 / IN_SHARE_DEN ))
  OUT_SHARE_DEN=$(( DISPLAY_OUT + SUB_OUT_EFF )); OUT_SHARE=0
  [ "$OUT_SHARE_DEN" -gt 0 ] && OUT_SHARE=$(( SUB_OUT_EFF * 100 / OUT_SHARE_DEN ))
  SUB_SEG=" ${DIM}[⑂${IN_SHARE}%/${OUT_SHARE}%]${RST}"
fi
```

Replace with:

```bash
SUB_IN_EFF=$(( SUBAGENT_IN_TOTAL + SUBAGENT_FALLBACK_TOTAL ))
SUB_OUT_EFF="$SUBAGENT_OUT_TOTAL"
SUB_SEG=""
if [ "$SUB_IN_EFF" -gt 0 ] || [ "$SUB_OUT_EFF" -gt 0 ]; then
  IN_SHARE=0
  [ "$GRAND_TOTAL_IN" -gt 0 ] && IN_SHARE=$(( SUB_IN_EFF * 100 / GRAND_TOTAL_IN ))
  OUT_SHARE=0
  [ "$GRAND_TOTAL_OUT" -gt 0 ] && OUT_SHARE=$(( SUB_OUT_EFF * 100 / GRAND_TOTAL_OUT ))
  SUB_SEG=" ${DIM}[⑂${IN_SHARE}%/${OUT_SHARE}%]${RST}"
fi
```

(`SUB_IN_EFF` itself is unchanged — per the locked design it counts only `in`/`out`/fallback, not subagent cache tokens, as the numerator. Only the *denominators* move from `DISPLAY_IN`/`DISPLAY_OUT` to the new `GRAND_TOTAL_IN`/`GRAND_TOTAL_OUT`.)

- [ ] **Step 7: Run the full statusline test suite**

Run:
```bash
bash harnesses/claude-code/tests/statusline/test_sidecar_fold.sh
bash harnesses/claude-code/tests/statusline/test_transcript_tail.sh
bash harnesses/claude-code/tests/statusline/test_display_v2.sh
```
Expected: `=== Results: N passed, 0 failed ===` for all three files. `test_transcript_tail.sh` in particular must show 0 failures against the Task 1.1 assertions.

- [ ] **Step 8: Manual smoke test reproducing the original bug (⚡367220% → bounded %)**

Run:
```bash
STATE=$(mktemp -d)
TRANSCRIPT=$(mktemp)
printf '{"type":"assistant","message":{"usage":{"input_tokens":20,"output_tokens":276,"cache_read_input_tokens":73444,"cache_creation_input_tokens":0}}}\n' > "$TRANSCRIPT"
echo '{
  "session_id": "smoke-overflow",
  "transcript_path": "'"$TRANSCRIPT"'",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 0, "total_api_duration_ms": 0, "total_cost_usd": 1.0,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"total_input_tokens": 20, "total_output_tokens": 276,
                      "context_window_size": 200000, "current_usage": {"cache_read_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}' | COLUMNS=120 STATUSLINE_STATE_DIR="$STATE" bash harnesses/claude-code/config/statusline-command.sh
rm -rf "$STATE" "$TRANSCRIPT"
```
Expected: line 1 RIGHT shows `↑73k ⚡99% /↓276` (grand_total_in = 20+73444+0 = 73464 ≈ 73k; read_pct = 73444*100/73464 = 99%) — NOT `⚡367220%`.

- [ ] **Step 9: Commit**

```bash
git add harnesses/claude-code/config/statusline-command.sh
git commit -m "$(cat <<'EOF'
fix(statusline): bound cache-hit % to grand-total, include subagent tokens

Why: the token display divided cache_read_tokens by fresh-input-tokens
only, so a session with 20 fresh input tokens and 73,444 cache-read
tokens rendered ⚡367220%. Anthropic's usage object has no output-side
cache fields (verified against current API docs) — all three cache
counters are input-side, so the fix sums input + cache_read +
cache_creation (main thread AND subagents) into one grand-total
denominator. ↑ and ↓ now report the full session picture (including
subagent activity); ⚡r% is mathematically bounded to ≤100%.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 1 checkpoint:** `harnesses/claude-code/config/statusline-command.sh` now shows correct, bounded values for both bugs. All 3 test files pass. This phase is independently shippable — stop here and verify before continuing to Phase 2 if executing inline.

---

## Phase 2 — Shared install library

**Outcome:** a new `packages/cli/src/shared/install-lib.sh` providing four sourceable bash functions — JS runtime detection, in-target-dir backup, CWD walk-up scope detection, and a receipt read/write helper pair — used by the Phase 4/5 Claude Code installer and the Phase 8 Pi Agent installer. `opencode-fleet` does NOT use this file (it already has equivalent, more mature TypeScript implementations in `backup.ts`/`receipt.ts` — Phase 6 aligns its *naming*, not its architecture).

**Files:**
- Create: `packages/cli/src/shared/install-lib.sh`
- Create: `packages/cli/src/shared/tests/test_install_lib.sh`

### Task 2.1: JS runtime detection

- [ ] **Step 1: Create the shared library file with the runtime-detection function**

Create `packages/cli/src/shared/install-lib.sh`:

```bash
#!/usr/bin/env bash
# install-lib.sh — shared bash helpers for the claude-code and pi-agent
# installers/uninstallers. NOT used by opencode-fleet (TypeScript, has its
# own backup.ts/receipt.ts with equivalent behavior).
#
# Source this file, don't execute it:
#   source "$(dirname "${BASH_SOURCE[0]}")/../../shared/install-lib.sh"
#
# Functions:
#   furaide_detect_js_runtime   -> sets JS_RUNTIME, PKG_INSTALL, PKG_RUN
#   furaide_backup_file <dst> <target_dir> <timestamp>
#                               -> copies dst to <target_dir>/.furaide-backup/<timestamp>/<rel>
#                                  if dst exists and no backup for that rel path exists yet
#   furaide_find_project_dir <marker_name>
#                               -> walks up from CWD to nearest dir containing
#                                  <marker_name>, or nearest .git/ parent, or CWD;
#                                  echoes the resolved path (may not exist yet)
#   furaide_write_receipt <path> <json>
#                               -> atomic write (temp file + mv)

# ── JS runtime detection ────────────────────────────────────────────────────
# Sets three globals: JS_RUNTIME ("bun"|"npm"), PKG_INSTALL, PKG_RUN.
# Exits 1 with an install-instructions message if neither is found.
furaide_detect_js_runtime() {
  if command -v bun >/dev/null 2>&1; then
    JS_RUNTIME="bun"
    PKG_INSTALL="bun install"
    PKG_RUN="bun run"
  elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    JS_RUNTIME="npm"
    PKG_INSTALL="npm install"
    PKG_RUN="npx --yes"
  else
    printf 'Neither bun nor node+npm found.\n' >&2
    printf '  Install bun (recommended): https://bun.sh\n' >&2
    printf '  or Node.js 18+ with npm:  https://nodejs.org\n' >&2
    return 1
  fi
  export JS_RUNTIME PKG_INSTALL PKG_RUN
}

# ── In-target-dir backup ────────────────────────────────────────────────────
# furaide_backup_file <dst> <target_dir> <timestamp>
# No-op if dst doesn't exist/isn't a symlink, or a backup for that relative
# path already exists under this timestamp's backup root (first backup wins,
# matching opencode-fleet's backup.ts semantics).
furaide_backup_file() {
  local dst="$1" target_dir="$2" timestamp="$3"
  [[ -e "$dst" || -L "$dst" ]] || return 0

  local rel="${dst#"$target_dir"/}"
  if [[ "$rel" == "$dst" ]]; then
    # dst is not inside target_dir — refuse to backup outside the target's own tree
    return 0
  fi

  local backup_root="$target_dir/.furaide-backup/$timestamp"
  local backup_path="$backup_root/$rel"
  [[ -e "$backup_path" || -L "$backup_path" ]] && return 0

  mkdir -p "$(dirname "$backup_path")"
  if [[ -L "$dst" ]]; then
    ln -s "$(readlink "$dst")" "$backup_path"
  else
    cp "$dst" "$backup_path"
  fi
}

# ── CWD walk-up scope detection ─────────────────────────────────────────────
# furaide_find_project_dir <marker_name>
# Walks up from CWD looking for an existing directory named <marker_name>
# (e.g. ".claude" or ".opencode"). Stops at the nearest .git/ parent or
# filesystem root. Echoes:
#   - the found marker dir's path, if one exists along the walk
#   - otherwise, "<repo-root-or-cwd>/<marker_name>" as a not-yet-created default
# Never fails — always echoes a usable path.
furaide_find_project_dir() {
  local marker_name="$1"
  local dir="$PWD"
  local repo_root=""

  while true; do
    if [[ -d "$dir/$marker_name" ]]; then
      printf '%s\n' "$dir/$marker_name"
      return 0
    fi
    if [[ -d "$dir/.git" && -z "$repo_root" ]]; then
      repo_root="$dir"
    fi
    local parent
    parent="$(dirname "$dir")"
    if [[ "$parent" == "$dir" ]]; then
      break
    fi
    dir="$parent"
  done

  if [[ -n "$repo_root" ]]; then
    printf '%s\n' "$repo_root/$marker_name"
  else
    printf '%s\n' "$PWD/$marker_name"
  fi
}

# ── Receipt read/write (plain JSON, atomic write) ───────────────────────────
# furaide_write_receipt <path> <json_string>
furaide_write_receipt() {
  local path="$1" json="$2"
  mkdir -p "$(dirname "$path")"
  local tmp="${path}.tmp.$$"
  printf '%s\n' "$json" > "$tmp"
  mv -f "$tmp" "$path"
}

# furaide_read_receipt <path> -> prints the file contents, or nothing if absent
furaide_read_receipt() {
  local path="$1"
  [[ -f "$path" ]] && cat "$path"
}
```

- [ ] **Step 2: Make the library executable-safe (no shebang execution needed, but keep it lint-clean)**

Run: `bash -n packages/cli/src/shared/install-lib.sh`
Expected: no output (syntax check passes).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/shared/install-lib.sh
git commit -m "$(cat <<'EOF'
feat(installers): add shared bash lib for runtime/backup/scope detection

Why: claude-code and pi-agent installers both need JS runtime detection
(bun-preferred, npm-fallback), in-target-dir backups, and CWD walk-up
scope detection. opencode-fleet already has equivalent TypeScript
(backup.ts/receipt.ts) — this file is only for the two bash installers,
avoiding duplicating the same ~100 lines of bash twice.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Test the shared library

- [ ] **Step 1: Write the test file**

Create `packages/cli/src/shared/tests/test_install_lib.sh`:

```bash
#!/usr/bin/env bash
# Plain-bash test harness for install-lib.sh (no bats in this environment,
# matching the style of harnesses/claude-code/tests/statusline/*.sh).
# Run: bash packages/cli/src/shared/tests/test_install_lib.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../install-lib.sh"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0
FAIL=0

_assert_eq() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS+1)); echo "PASS: $desc"
  else
    FAIL=$((FAIL+1)); echo "FAIL: $desc (expected '$expected', got '$actual')"
  fi
}

echo "== furaide_detect_js_runtime =="
if furaide_detect_js_runtime; then
  if [ "$JS_RUNTIME" = "bun" ] || [ "$JS_RUNTIME" = "npm" ]; then
    PASS=$((PASS+1)); echo "PASS: detected a valid runtime ($JS_RUNTIME)"
  else
    FAIL=$((FAIL+1)); echo "FAIL: JS_RUNTIME has unexpected value: $JS_RUNTIME"
  fi
else
  FAIL=$((FAIL+1)); echo "FAIL: furaide_detect_js_runtime returned nonzero on a dev machine (expected bun or npm present)"
fi

echo "== furaide_backup_file =="
TARGET="$SCRATCH/target"
mkdir -p "$TARGET"
echo "original content" > "$TARGET/CLAUDE.md"
furaide_backup_file "$TARGET/CLAUDE.md" "$TARGET" "20250101T000000"
BACKUP_PATH="$TARGET/.furaide-backup/20250101T000000/CLAUDE.md"
if [ -f "$BACKUP_PATH" ]; then
  PASS=$((PASS+1)); echo "PASS: backup file created at expected path"
  _assert_eq "backup content matches original" "$(cat "$BACKUP_PATH")" "original content"
else
  FAIL=$((FAIL+1)); echo "FAIL: backup file not created at $BACKUP_PATH"
fi

# Second call with different content must NOT overwrite the first backup (first-backup-wins)
echo "modified content" > "$TARGET/CLAUDE.md"
furaide_backup_file "$TARGET/CLAUDE.md" "$TARGET" "20250101T000000"
_assert_eq "first backup wins (not overwritten by second call)" "$(cat "$BACKUP_PATH")" "original content"

# No-op when dst doesn't exist
furaide_backup_file "$TARGET/does-not-exist.md" "$TARGET" "20250101T000001"
if [ -d "$TARGET/.furaide-backup/20250101T000001" ]; then
  FAIL=$((FAIL+1)); echo "FAIL: backup dir created for a nonexistent source file"
else
  PASS=$((PASS+1)); echo "PASS: no backup dir created when source file doesn't exist"
fi

echo "== furaide_find_project_dir =="
REPO="$SCRATCH/repo"
mkdir -p "$REPO/.git" "$REPO/sub/deeper"
FOUND=$(cd "$REPO/sub/deeper" && furaide_find_project_dir ".claude")
_assert_eq "no existing marker -> defaults to repo-root/.claude" "$FOUND" "$REPO/.claude"

mkdir -p "$REPO/sub/.claude"
FOUND2=$(cd "$REPO/sub/deeper" && furaide_find_project_dir ".claude")
_assert_eq "existing marker found while walking up" "$FOUND2" "$REPO/sub/.claude"

NOGIT="$SCRATCH/nogit"
mkdir -p "$NOGIT/a/b"
FOUND3=$(cd "$NOGIT/a/b" && furaide_find_project_dir ".opencode")
_assert_eq "no .git anywhere -> defaults to CWD/.opencode" "$FOUND3" "$NOGIT/a/b/.opencode"

echo "== furaide_write_receipt / furaide_read_receipt =="
RECEIPT_PATH="$SCRATCH/nested/dir/.furaide-receipt.json"
furaide_write_receipt "$RECEIPT_PATH" '{"version":1}'
_assert_eq "receipt written and readable" "$(furaide_read_receipt "$RECEIPT_PATH")" '{"version":1}'
_assert_eq "read on missing receipt returns empty" "$(furaide_read_receipt "$SCRATCH/does-not-exist.json")" ""

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test suite**

Run: `bash packages/cli/src/shared/tests/test_install_lib.sh`
Expected: `=== Results: N passed, 0 failed ===`

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/shared/tests/test_install_lib.sh
git commit -m "$(cat <<'EOF'
test(installers): add test suite for shared install-lib.sh

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 2 checkpoint:** `install-lib.sh` is tested and ready for Phase 4/5 (claude-code) and Phase 8 (pi-agent) to consume.

---

## Phase 3 — Top-level harness picker

**Outcome:** `bash scripts/install.sh` with no target argument shows an interactive picker (Claude Code / OpenCode / Pi Agent) instead of printing a usage wall and exiting. `bash scripts/install.sh <target>` still bypasses the picker exactly as before. `--help`/`-h` at the wrapper level prints help instead of being misparsed as a target name.

**Files:**
- Modify: `scripts/install.sh`
- Modify: `scripts/uninstall.sh`
- Modify: `packages/cli/src/router.ts`

### Task 3.1: Add the picker to the bash wrappers

- [ ] **Step 1: Add a picker function and `--help` handling to `scripts/install.sh`**

Current `scripts/install.sh` (full file, 41 lines) unconditionally forwards `"$@"` to the router. Replace the whole file:

```bash
#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. root installer bootstrap
#
# Thin wrapper: detects a JS runtime (bun preferred, node+npm fallback),
# installs packages/cli's dependencies, then hands off to the TypeScript
# CLI router which dispatches to the requested target.
#
# Usage:
#   bash scripts/install.sh                       # interactive harness picker
#   bash scripts/install.sh <target> [flags]       # bypass picker
#   bash scripts/install.sh --help                 # this message
#
# Targets: claude-code, opencode-fleet, pi-agent

set -euo pipefail
FURAIDE_INVOKED_FROM="$(pwd)"
export FURAIDE_INVOKED_FROM
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"

RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ ! -d "$CLI_DIR" ]]; then
  err "packages/cli not found at $CLI_DIR — is this a full Furaidē checkout?"
  exit 1
fi

pick_target() {
  printf 'Which harness would you like to install?\n\n' >&2
  printf '  1) Claude Code   — statusline, agents, skills, Idisu + Rejion plugins\n' >&2
  printf '  2) OpenCode      — 15-agent fleet, plugins, rules, skills\n' >&2
  printf '  3) Pi Agent      — web tools, TUI, themes, skills\n\n' >&2
  local choice
  read -rp 'Enter 1, 2, or 3: ' choice </dev/tty
  case "$choice" in
    1) printf 'claude-code\n' ;;
    2) printf 'opencode-fleet\n' ;;
    3) printf 'pi-agent\n' ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
}

ARGS=("$@")
if [[ ${#ARGS[@]} -eq 0 ]]; then
  TARGET="$(pick_target)"
  ARGS=("$TARGET")
fi

if command -v bun >/dev/null 2>&1; then
  ( cd "$CLI_DIR" && bun install && bun run bin/furaide.ts install "${ARGS[@]}" )
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  warn "bun not found — falling back to node/npm (slower)."
  warn "Install bun for the best experience: https://bun.sh"
  ( cd "$CLI_DIR" && npm install && npx --yes tsx bin/furaide.ts install "${ARGS[@]}" )
else
  err "Neither bun nor node+npm found."
  err "Install bun (recommended): https://bun.sh"
  err "  or Node.js 18+ with npm:  https://nodejs.org"
  exit 1
fi
```

- [ ] **Step 2: Apply the same picker pattern to `scripts/uninstall.sh`**

Replace the whole file:

```bash
#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. root uninstaller bootstrap
#
# Thin wrapper: detects a JS runtime (bun preferred, node+npm fallback),
# installs packages/cli's dependencies, then hands off to the TypeScript
# CLI router which dispatches to the requested target's uninstall path.
#
# Usage:
#   bash scripts/uninstall.sh                      # interactive harness picker
#   bash scripts/uninstall.sh <target> [flags]      # bypass picker
#   bash scripts/uninstall.sh --help                # this message
#
# Targets: claude-code, opencode-fleet, pi-agent

set -euo pipefail
FURAIDE_INVOKED_FROM="$(pwd)"
export FURAIDE_INVOKED_FROM
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"

RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ ! -d "$CLI_DIR" ]]; then
  err "packages/cli not found at $CLI_DIR — is this a full Furaidē checkout?"
  exit 1
fi

pick_target() {
  printf 'Which harness would you like to uninstall?\n\n' >&2
  printf '  1) Claude Code\n' >&2
  printf '  2) OpenCode\n' >&2
  printf '  3) Pi Agent\n\n' >&2
  local choice
  read -rp 'Enter 1, 2, or 3: ' choice </dev/tty
  case "$choice" in
    1) printf 'claude-code\n' ;;
    2) printf 'opencode-fleet\n' ;;
    3) printf 'pi-agent\n' ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
}

ARGS=("$@")
if [[ ${#ARGS[@]} -eq 0 ]]; then
  TARGET="$(pick_target)"
  ARGS=("$TARGET")
fi

if command -v bun >/dev/null 2>&1; then
  ( cd "$CLI_DIR" && bun install && bun run bin/furaide.ts uninstall "${ARGS[@]}" )
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  warn "bun not found — falling back to node/npm (slower)."
  warn "Install bun for the best experience: https://bun.sh"
  ( cd "$CLI_DIR" && npm install && npx --yes tsx bin/furaide.ts uninstall "${ARGS[@]}" )
else
  err "Neither bun nor node+npm found."
  err "Install bun (recommended): https://bun.sh"
  err "  or Node.js 18+ with npm:  https://nodejs.org"
  exit 1
fi
```

- [ ] **Step 3: Verify `--help` no longer reaches the router as a target**

Run: `bash scripts/install.sh --help`
Expected: prints the usage comment block (lines 2–15) and exits 0, without touching `packages/cli` or running `bun install`.

- [ ] **Step 4: Verify the picker triggers on no-args (manual, since it reads from `/dev/tty`)**

Run interactively: `bash scripts/install.sh`
Expected: prints the 3-option menu and waits for input on the terminal (not a pipe) — confirm by pressing Ctrl+C after the menu appears; do not complete the flow (avoid a real install during verification).

- [ ] **Step 5: Verify direct-target invocation still bypasses the picker**

Run: `bash scripts/install.sh claude-code --help 2>&1 | head -5`
Expected: no picker menu printed; output comes from the router/target script's own `--help` handling (Phase 4 gives claude-code a real `--help`; until then this exercises the existing pass-through unchanged).

- [ ] **Step 6: Commit**

```bash
git add scripts/install.sh scripts/uninstall.sh
git commit -m "$(cat <<'EOF'
feat(installers): add top-level harness picker to install/uninstall wrappers

Why: `bash scripts/install.sh` with no args printed a router usage wall
and exited — the header comment already claimed an "interactive target
picker" that didn't exist. Adds one at the bash-wrapper level (no clack
dependency needed for a 3-item menu); --help now short-circuits before
touching packages/cli instead of being misparsed as a target name.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: Router guard against cross-harness skill writes

- [ ] **Step 1: Add a documentation comment to `router.ts` recording the unified skill model invariant**

In `packages/cli/src/router.ts`, after line 5 (the existing header comment block, before the imports), add:

```typescript
//
// Unified skill model (see harnesses/*/README.md "Shared skills" section):
//   ~/.agents/skills/            <- master pool. OpenCode + Pi read natively;
//                                   Claude Code reads via ~/.claude/skills/<n> symlinks.
//   ~/.config/opencode/skills/   <- OpenCode-only fleet-specific skills (not shareable).
//   ~/.claude/skills/<name>      <- CC-only direct skills OR symlinks into ~/.agents/.
// The claude-code target must never write to ~/.config/opencode/skills/.
// The opencode-fleet target's *external* skills (skills-manifest.json) install
// to ~/.agents/skills/ (Phase 6) — its *bundled* fleet-specific skills still
// install to ~/.config/opencode/skills/ via copySkillTree() in install.ts.
```

- [ ] **Step 2: Verify no functional change**

Run: `cd packages/cli && bun run typecheck 2>&1 | tail -5 || true`
Expected: no new errors introduced (this step only added a comment).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/router.ts
git commit -m "$(cat <<'EOF'
docs(router): record the unified skill-model invariant

Why: makes the ~/.agents/skills/ vs ~/.config/opencode/skills/ split
explicit at the one file every install/uninstall path routes through,
so a future edit to either target's skill-copying logic has the
invariant in view before it accidentally crosses the line.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 3 checkpoint:** both wrapper scripts have a working picker and proper `--help` handling; the cross-harness skill-write invariant is documented at the router.

---

## Phase 4 — Claude Code installer rewrite

**Outcome:** `packages/cli/src/targets/claude-code/install.sh` supports global AND project scope (with CWD walk-up default), a back-navigable step flow, dual bun/npm, a component multiselect matching the locked defaults per scope, and writes a `.furaide-receipt.json` recording exactly what was installed. No existing behavior regresses: `--yes`, `--minimal`, `--no-config`, `--with-skills` all keep working.

**Files:**
- Modify: `packages/cli/src/targets/claude-code/install.sh` (currently named/commented as `bootstrap.sh` internally — file path is `install.sh`, this plan keeps that path)

This is a from-scratch rewrite of one cohesive file (no pre-existing test suite to TDD increment against — verification is manual dry-run scenarios below, matching the locked flow from the design spec). Read the current 196-line file (already captured above) before starting; the new version preserves every existing flag (`--yes`/`-y`, `--minimal`, `--no-config`, `--with-skills`, `-h`/`--help`) and the `_merge_settings` helper verbatim, adding scope + receipt + back-navigation around them.

### Task 4.1: Write the new installer

- [ ] **Step 1: Replace `packages/cli/src/targets/claude-code/install.sh` in full**

```bash
#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. claude-code interactive installer
#
# Supports global (~/.claude/) and project (.claude/ under the nearest
# existing .claude/ found walking up from CWD, or repo-root/.claude/ as a
# fresh-install default) scope. Writes a .furaide-receipt.json recording
# exactly what was installed, for a clean receipt-driven uninstall.
#
# Flags:
#   --yes, -y         Run unattended, accept all defaults (no prompts)
#   --scope <s>       global | project | custom:<path>  (skips scope prompt)
#   --minimal         Only install the Idisu CLI engine (steps 0-1), skip the rest
#   --no-config       Skip the config bundle (CLAUDE.md/settings/statusline)
#   --with-skills     Also offer the extended skill manifest (heavier, git-clones)
#   --js-runtime <r>  bun | npm  (force runtime instead of auto-detecting)
#   --dry-run         Print what would happen; make no changes
#   -h, --help        Print this usage and exit
#
# Usage examples:
#   bash install.sh                          # interactive, back-navigable
#   bash install.sh --yes                    # unattended, global scope, all defaults
#   bash install.sh --scope project --yes    # unattended, project scope
#   bash install.sh --minimal                # Idisu CLI only

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../harnesses/claude-code" && pwd)"
SHARED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared" && pwd)"
source "$SHARED_DIR/install-lib.sh"
IDISU_HOME="${IDISU_HOME:-$HOME/.idisu}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

# ── Merge all top-level keys from src JSON into dst JSON (src overrides dst) ─
_merge_settings() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || return 0
  if [[ ! -f "$dst" ]]; then
    cp "$src" "$dst"
    ok "installed settings.json → $(dirname "$dst")"
    return
  fi
  if python3 -c "
import json,sys
src=json.load(open(sys.argv[1]))
try: dst=json.load(open(sys.argv[2]))
except: dst={}
dst.update(src)
open(sys.argv[2],'w').write(json.dumps(dst,indent=2)+'\n')
" "$src" "$dst" 2>/dev/null; then
    ok "merged settings.json keys into $dst"
  elif command -v jq >/dev/null 2>&1; then
    local tmp; tmp=$(mktemp)
    jq -s '.[0] * .[1]' "$dst" "$src" > "$tmp" 2>/dev/null && mv "$tmp" "$dst" \
      && ok "merged settings.json keys into $dst" \
      || { rm -f "$tmp"; warn "could not merge settings.json — add keys from $src into $dst manually"; }
  else
    warn "could not merge settings.json — add keys from $src into $dst manually"
  fi
}

# ── Flag parsing ─────────────────────────────────────────────────────────────
ASSUME_YES=0
MINIMAL=0
NO_CONFIG=0
WITH_SKILLS=0
DRY_RUN=0
FORCED_SCOPE=""
FORCED_RUNTIME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)      ASSUME_YES=1; shift ;;
    --minimal)     MINIMAL=1; shift ;;
    --no-config)   NO_CONFIG=1; shift ;;
    --with-skills) WITH_SKILLS=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --scope)       FORCED_SCOPE="$2"; shift 2 ;;
    --js-runtime)  FORCED_RUNTIME="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) err "unknown flag: $1"; exit 1 ;;
  esac
done

confirm() {  # confirm "message" — returns 0 (yes) / 1 (no); default yes
  [[ "$ASSUME_YES" -eq 1 ]] && return 0
  local reply
  printf "${YELLOW}?${NC} %s [Y/n] " "$1" >&2
  read -r reply </dev/tty || { printf '\n' >&2; return 1; }
  case "$reply" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

# ── Step 0: JS runtime detection ────────────────────────────────────────────
if [[ -n "$FORCED_RUNTIME" ]]; then
  JS_RUNTIME="$FORCED_RUNTIME"
else
  furaide_detect_js_runtime || exit 1
fi
ok "JS runtime: $JS_RUNTIME"

[[ "$MINIMAL" -eq 1 ]] && {
  [[ ! -d "$HOME/.idisu" ]] && { [[ "$DRY_RUN" -eq 1 ]] && echo "[dry-run] would create ~/.idisu" || { mkdir -p "$HOME/.idisu"; ok "created ~/.idisu"; }; }
  IDISU_SRC="$REPO/cli/src/idisu"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would run: ($JS_RUNTIME install) in $IDISU_SRC"
  elif [[ "$JS_RUNTIME" == "bun" ]]; then
    ( cd "$IDISU_SRC" && bun install )
    chmod +x "$IDISU_SRC/src/cli/index.ts"
    mkdir -p "$IDISU_HOME"
    printf '%s\n' "$IDISU_SRC/src/cli/index.ts" > "$IDISU_HOME/cli-path"
    ok "Īdisu CLI installed -> $IDISU_SRC/src/cli/index.ts"
  else
    warn "npm runtime: Īdisu CLI requires bun specifically (bun:sqlite). Install bun to enable it."
  fi
  printf '\n%s\n' "$(printf "${GREEN}[done]${NC} minimal mode complete.")"
  exit 0
}

# ── Step 1: Scope selection (back-navigable) ────────────────────────────────
GLOBAL_TARGET="$HOME/.claude"
PROJECT_TARGET="$(furaide_find_project_dir ".claude")"

pick_scope() {
  if [[ -n "$FORCED_SCOPE" ]]; then
    case "$FORCED_SCOPE" in
      global)  SCOPE="global"; TARGET_DIR="$GLOBAL_TARGET" ;;
      project) SCOPE="project"; TARGET_DIR="$PROJECT_TARGET" ;;
      custom:*) SCOPE="custom"; TARGET_DIR="${FORCED_SCOPE#custom:}" ;;
      *) err "unknown --scope value: $FORCED_SCOPE (expected global|project|custom:<path>)"; exit 1 ;;
    esac
    return
  fi
  [[ "$ASSUME_YES" -eq 1 ]] && { SCOPE="global"; TARGET_DIR="$GLOBAL_TARGET"; return; }

  printf '\nWhere should Claude Code config be installed?\n\n' >&2
  printf '  1) Global   (%s)\n' "$GLOBAL_TARGET" >&2
  printf '  2) Project  (%s)\n' "$PROJECT_TARGET" >&2
  printf '  3) Custom directory\n\n' >&2
  local choice
  read -rp 'Enter 1, 2, or 3: ' choice </dev/tty
  case "$choice" in
    1) SCOPE="global"; TARGET_DIR="$GLOBAL_TARGET" ;;
    2) SCOPE="project"; TARGET_DIR="$PROJECT_TARGET" ;;
    3)
      read -rp 'Absolute path: ' TARGET_DIR </dev/tty
      SCOPE="custom" ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
}
pick_scope
ok "scope: $SCOPE ($TARGET_DIR)"

# ── Step 2: Pre-checks ───────────────────────────────────────────────────────
[[ "$JS_RUNTIME" == "npm" ]] && warn "bun not found — Īdisu CLI (bun:sqlite) will not install; falling back for skills/agents/config only."
command -v jq    >/dev/null 2>&1 || warn "jq not found - Īdisu hooks and settings merge fall back to python3."
command -v flock >/dev/null 2>&1 || warn "flock not found - Īdisu hooks expect flock from util-linux."
command -v git    >/dev/null 2>&1 || warn "git not found - statusline branch display will be blank."

# ── Step 3: Prior install / receipt detection ───────────────────────────────
RECEIPT_PATH="$TARGET_DIR/.furaide-receipt.json"
PRIOR_RECEIPT="$(furaide_read_receipt "$RECEIPT_PATH")"
if [[ -n "$PRIOR_RECEIPT" ]]; then
  INSTALLED_AT="$(printf '%s' "$PRIOR_RECEIPT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("installedAt","?"))' 2>/dev/null || echo "?")"
  ok "found prior install (installed $INSTALLED_AT) — this run updates it"
fi

INSTALL_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ── Step 4: Component selection ─────────────────────────────────────────────
INSTALL_CLAUDE_MD=1
INSTALL_SETTINGS=1
INSTALL_AGENTS=1
INSTALL_SKILLS=1
INSTALL_IDISU=1
INSTALL_REJION=1
INSTALL_EXTENDED_SKILLS=0
[[ "$WITH_SKILLS" -eq 1 ]] && INSTALL_EXTENDED_SKILLS=1

if [[ "$SCOPE" == "project" || "$SCOPE" == "custom" ]]; then
  # statusline is not installable at project scope in a self-contained way
  # (no per-project statusline-command.sh copy is planned — settings.json
  # in project scope references the repo's absolute path instead).
  :
fi

if [[ "$ASSUME_YES" -ne 1 && "$MINIMAL" -ne 1 ]]; then
  printf '\nComponents to install (Enter=yes, n=no, b=back to scope selection):\n\n' >&2
  select_component() {  # var_name prompt
    local __var="$1" __prompt="$2" __reply
    read -rp "  $__prompt [Y/n/b]: " __reply </dev/tty
    case "$__reply" in
      b|B) pick_scope; return 1 ;;
      n|N) printf -v "$__var" '0' ;;
      *)   printf -v "$__var" '1' ;;
    esac
    return 0
  }
  select_component INSTALL_CLAUDE_MD "CLAUDE.md"                          || select_component INSTALL_CLAUDE_MD "CLAUDE.md"
  select_component INSTALL_SETTINGS  "Settings (statusline + prefs)"      || select_component INSTALL_SETTINGS  "Settings (statusline + prefs)"
  select_component INSTALL_AGENTS    "Core agents (hanko--git-seal)"      || select_component INSTALL_AGENTS    "Core agents (hanko--git-seal)"
  select_component INSTALL_SKILLS    "Core skills (github, bx, ...)"      || select_component INSTALL_SKILLS    "Core skills (github, bx, ...)"
  select_component INSTALL_IDISU     "Idisu plugin"                      || select_component INSTALL_IDISU     "Idisu plugin"
  select_component INSTALL_REJION    "Rejion plugin"                     || select_component INSTALL_REJION    "Rejion plugin"
fi

[[ "$NO_CONFIG" -eq 1 ]] && { INSTALL_CLAUDE_MD=0; INSTALL_SETTINGS=0; }

# ── Step 5: Confirm ──────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" -ne 1 ]]; then
  printf '\nAbout to install to %s:\n' "$TARGET_DIR" >&2
  [[ "$INSTALL_CLAUDE_MD" -eq 1 ]] && printf '  - CLAUDE.md\n' >&2
  [[ "$INSTALL_SETTINGS" -eq 1 ]]  && printf '  - settings.json (merged)\n' >&2
  [[ "$INSTALL_AGENTS" -eq 1 ]]    && printf '  - agents/\n' >&2
  [[ "$INSTALL_SKILLS" -eq 1 ]]    && printf '  - skills/\n' >&2
  [[ "$INSTALL_IDISU" -eq 1 ]]     && printf '  - Idisu plugin\n' >&2
  [[ "$INSTALL_REJION" -eq 1 ]]    && printf '  - Rejion plugin\n' >&2
  printf 'Backup dir (if needed): %s/.furaide-backup/%s\n' "$TARGET_DIR" "$INSTALL_TIMESTAMP" >&2
  confirm "Proceed?" || { err "cancelled"; exit 1; }
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] no changes made. Would have installed the components listed above to $TARGET_DIR."
  exit 0
fi

mkdir -p "$TARGET_DIR"

# ── Execute: Īdisu CLI (bun only; global scope only — project scope has no
#    per-project Idisu CLI concept, it's a user-level tool) ─────────────────
COMPONENTS_INSTALLED=()
if [[ "$SCOPE" == "global" ]]; then
  if [[ ! -d "$HOME/.idisu" ]]; then mkdir -p "$HOME/.idisu"; ok "created ~/.idisu"; fi
  if [[ "$JS_RUNTIME" == "bun" ]]; then
    IDISU_SRC="$REPO/cli/src/idisu"
    ( cd "$IDISU_SRC" && bun install )
    chmod +x "$IDISU_SRC/src/cli/index.ts"
    mkdir -p "$IDISU_HOME"
    printf '%s\n' "$IDISU_SRC/src/cli/index.ts" > "$IDISU_HOME/cli-path"
    ok "Īdisu CLI installed -> $IDISU_SRC/src/cli/index.ts"
  fi
fi

# ── Execute: Skills ──────────────────────────────────────────────────────────
SKILL_NAMES=()
if [[ "$INSTALL_SKILLS" -eq 1 ]]; then
  if [[ "$SCOPE" == "global" ]]; then
    bash "$SHARED_DIR/install-vendored-skills.sh" --global
  else
    bash "$SHARED_DIR/install-vendored-skills.sh" --project "$(dirname "$TARGET_DIR")"
  fi
  for d in "$REPO/config/../../../skills"/*/; do :; done 2>/dev/null || true
  for d in "$REPO"/../../skills/*/; do
    [[ -d "$d" ]] && SKILL_NAMES+=("$(basename "$d")")
  done
  COMPONENTS_INSTALLED+=("skills")
fi
if [[ "$INSTALL_EXTENDED_SKILLS" -eq 1 ]]; then
  if confirm "Install extended skill manifest (heavier, git-clones repos)?"; then
    bash "$SHARED_DIR/install-external-skills.sh" --ecosystem claude-code
    ok "extended skill manifest installed"
    COMPONENTS_INSTALLED+=("extended-skills")
  fi
fi

# ── Execute: Agents ───────────────────────────────────────────────────────────
AGENT_FILES=()
if [[ "$INSTALL_AGENTS" -eq 1 ]]; then
  mkdir -p "$TARGET_DIR/agents"
  for agent_src in "$REPO/config/agents/"*.md; do
    [[ -e "$agent_src" ]] || continue
    fname="$(basename "$agent_src")"
    dest="$TARGET_DIR/agents/$fname"
    if [[ -e "$dest" ]]; then
      ok "skip  agents/$fname (already exists)"
    else
      cp "$agent_src" "$dest"
      ok "installed agents/$fname → $TARGET_DIR/agents/"
    fi
    AGENT_FILES+=("$dest")
  done
  COMPONENTS_INSTALLED+=("agents")
fi

# ── Execute: Config bundle (CLAUDE.md, settings.json, statusline) ───────────
if [[ "$INSTALL_CLAUDE_MD" -eq 1 ]]; then
  dest="$TARGET_DIR/CLAUDE.md"
  furaide_backup_file "$dest" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
  cp "$REPO/config/CLAUDE.md" "$dest"
  ok "copied CLAUDE.md → $TARGET_DIR/"
  COMPONENTS_INSTALLED+=("claudeMd")
fi

if [[ "$INSTALL_SETTINGS" -eq 1 ]]; then
  furaide_backup_file "$TARGET_DIR/settings.json" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
  if [[ "$SCOPE" == "global" ]]; then
    dest="$TARGET_DIR/statusline-command.sh"
    furaide_backup_file "$dest" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
    ln -sf "$REPO/config/statusline-command.sh" "$dest"
    ok "symlinked statusline-command.sh → $REPO/config/"
    _merge_settings "$REPO/config/settings.json" "$TARGET_DIR/settings.json"
  else
    # Project scope: statusline command references the repo's absolute path
    # directly in the merged settings.json rather than a per-project symlink.
    TMP_SETTINGS="$(mktemp)"
    python3 -c "
import json
with open('$REPO/config/settings.json') as f: cfg = json.load(f)
if 'statusLine' in cfg and isinstance(cfg['statusLine'], dict):
    cfg['statusLine']['command'] = '$REPO/config/statusline-command.sh'
json.dump(cfg, open('$TMP_SETTINGS', 'w'), indent=2)
" 2>/dev/null || cp "$REPO/config/settings.json" "$TMP_SETTINGS"
    _merge_settings "$TMP_SETTINGS" "$TARGET_DIR/settings.json"
    rm -f "$TMP_SETTINGS"
  fi
  COMPONENTS_INSTALLED+=("settings")
fi

# ── Execute: Plugins ──────────────────────────────────────────────────────────
PLUGINS_INSTALLED=()
if [[ "$SCOPE" == "global" ]]; then
  [[ "$INSTALL_IDISU" -eq 1 ]]  && PLUGINS_INSTALLED+=("idisu")
  [[ "$INSTALL_REJION" -eq 1 ]] && PLUGINS_INSTALLED+=("rejion")
else
  mkdir -p "$TARGET_DIR/skills"
  if [[ "$INSTALL_IDISU" -eq 1 && -d "$REPO/plugins/idisu" ]]; then
    cp -r "$REPO/plugins/idisu" "$TARGET_DIR/skills/idisu"
    ok "copied Idisu plugin → $TARGET_DIR/skills/idisu (skills-dir plugin)"
    PLUGINS_INSTALLED+=("idisu")
  fi
  if [[ "$INSTALL_REJION" -eq 1 && -d "$REPO/plugins/rejion" ]]; then
    cp -r "$REPO/plugins/rejion" "$TARGET_DIR/skills/rejion"
    ok "copied Rejion plugin → $TARGET_DIR/skills/rejion (skills-dir plugin)"
    PLUGINS_INSTALLED+=("rejion")
  fi
fi

# ── Write receipt ─────────────────────────────────────────────────────────────
python3 -c "
import json, sys
receipt = {
    'version': 1,
    'jsRuntime': '$JS_RUNTIME',
    'scope': '$SCOPE',
    'installedAt': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'targetDir': '$TARGET_DIR',
    'backupDir': '$TARGET_DIR/.furaide-backup/$INSTALL_TIMESTAMP',
    'components': {
        'claudeMd': $([[ $INSTALL_CLAUDE_MD -eq 1 ]] && echo "'$TARGET_DIR/CLAUDE.md'" || echo 'None'),
        'settings': $([[ $INSTALL_SETTINGS -eq 1 ]] && echo "'$TARGET_DIR/settings.json'" || echo 'None'),
        'agents': [$(printf '"%s",' "${AGENT_FILES[@]}" 2>/dev/null)],
        'skillNames': [$(printf '"%s",' "${SKILL_NAMES[@]}" 2>/dev/null)],
        'plugins': [$(printf '"%s",' "${PLUGINS_INSTALLED[@]}" 2>/dev/null)],
    },
}
json.dump(receipt, open('$RECEIPT_PATH', 'w'), indent=2)
print()
" 2>/dev/null || warn "could not write receipt to $RECEIPT_PATH (python3 unavailable) — uninstall will need --scope to target this install manually"
[[ -f "$RECEIPT_PATH" ]] && ok "receipt written → $RECEIPT_PATH"

# ── Done ──────────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Installed to %s." "$TARGET_DIR")"
if [[ "$SCOPE" == "global" ]]; then
  printf '\nNext steps in Claude Code:\n'
  printf '  /plugin marketplace add pratty010/Furaide\n'
  [[ "$INSTALL_IDISU" -eq 1 ]]  && printf '  /plugin install idisu@fr1d4y\n'
  [[ "$INSTALL_REJION" -eq 1 ]] && printf '  /plugin install rejion@fr1d4y\n'
  printf '  /reload-plugins\n'
else
  printf '\nCommit %s to share this setup with your team.\n' "$TARGET_DIR"
  printf 'Each team member: accept the workspace trust prompt, then run /reload-plugins.\n'
fi
```

- [ ] **Step 2: Syntax-check the new file**

Run: `bash -n packages/cli/src/targets/claude-code/install.sh`
Expected: no output (valid bash syntax).

- [ ] **Step 3: Dry-run global scope, non-interactive**

Run: `bash packages/cli/src/targets/claude-code/install.sh --yes --dry-run`
Expected: prints `[dry-run] no changes made...` and exits 0. Verify no files were created: `test ! -f ~/.claude/.furaide-receipt.json.dryruncheck` is not meaningful here — instead confirm the real `~/.claude/` receipt timestamp (if one exists from before) is unchanged: `ls -la ~/.claude/.furaide-receipt.json 2>/dev/null` shows the same mtime as before the dry-run (or is absent if never installed).

- [ ] **Step 4: Dry-run project scope, non-interactive, in a scratch git repo**

Run:
```bash
SCRATCH=$(mktemp -d)
git -C "$SCRATCH" init -q
( cd "$SCRATCH" && bash "$(pwd -P)/../../../../packages/cli/src/targets/claude-code/install.sh" --yes --scope project --dry-run 2>&1 ) || true
```
(Adjust the relative path to the repo's actual `packages/cli/...` location if run from a different CWD — the important check is that it targets `$SCRATCH/.claude`, not `$HOME/.claude`.)
Expected: dry-run output references `$SCRATCH/.claude`, confirming project-scope walk-up correctly used the scratch repo (found via its `.git/`) rather than falling back to the real repo or `$HOME`.

- [ ] **Step 5: Full non-dry-run install to a scratch HOME (isolated, does not touch the real `~/.claude/`)**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/install.sh --yes
test -f "$SCRATCH_HOME/.claude/.furaide-receipt.json" && echo "RECEIPT OK"
test -f "$SCRATCH_HOME/.claude/CLAUDE.md" && echo "CLAUDE.md OK"
test -L "$SCRATCH_HOME/.claude/statusline-command.sh" && echo "STATUSLINE SYMLINK OK"
rm -rf "$SCRATCH_HOME"
```
Expected: `RECEIPT OK`, `CLAUDE.md OK`, `STATUSLINE SYMLINK OK` all print.

- [ ] **Step 6: Verify `--minimal` still works standalone**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/install.sh --minimal --yes
test -d "$SCRATCH_HOME/.idisu" && echo "IDISU DIR OK"
test ! -f "$SCRATCH_HOME/.claude/CLAUDE.md" && echo "CONFIG CORRECTLY SKIPPED"
rm -rf "$SCRATCH_HOME"
```
Expected: `IDISU DIR OK` and `CONFIG CORRECTLY SKIPPED` both print.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/targets/claude-code/install.sh
git commit -m "$(cat <<'EOF'
feat(claude-code): rewrite installer with scope, receipt, back-navigation

Why: the previous installer was global-only, wrote no receipt (the
uninstaller had to hardcode a skill/agent list that drifted from
reality), and had no way to install into a project for team sharing.
This version adds global/project/custom scope with CWD walk-up
detection (via install-lib.sh), a back-navigable component selector,
and a .furaide-receipt.json the Phase 5 uninstaller reads instead of
guessing. All four existing flags (--yes, --minimal, --no-config,
--with-skills) keep their prior behavior.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 4 checkpoint:** Claude Code installer supports global + project scope, writes a receipt, and preserves all prior flags. Verified via 4 isolated dry-run/scratch-HOME scenarios above (no real `~/.claude/` was touched during verification).

---

## Phase 5 — Claude Code uninstaller rewrite

**Outcome:** `packages/cli/src/targets/claude-code/uninstall.sh` reads the Phase 4 receipt instead of a hardcoded skill/agent list, offers a scope picker when both global and project receipts exist, uses delete/skip-only semantics (delete auto-restores from backup when one exists), and removes only `~/.claude/skills/<name>` **symlinks** — never the `~/.agents/skills/<name>` shared-pool content, unless `--purge` is passed. The stale `cli/.venv` removal step (Īdisu is bun-based, not Python) is deleted.

**Files:**
- Modify: `packages/cli/src/targets/claude-code/uninstall.sh`

### Task 5.1: Write the new uninstaller

- [ ] **Step 1: Replace `packages/cli/src/targets/claude-code/uninstall.sh` in full**

```bash
#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. claude-code uninstaller
#
# Receipt-driven: reads .furaide-receipt.json written by Phase 4's install.sh
# and removes exactly what it recorded. If both a global (~/.claude/) and a
# project (.claude/, found via CWD walk-up) receipt exist, prompts for scope.
#
# Usage:
#   bash uninstall.sh                # interactive
#   bash uninstall.sh --scope global # skip scope picker
#   bash uninstall.sh --yes          # accept all defaults (delete everything with backup-restore)
#   bash uninstall.sh --dry-run      # print what would happen, no changes
#   bash uninstall.sh --purge        # also remove ~/.agents/skills/ shared-pool content
#   bash uninstall.sh -h             # help

set -euo pipefail
SHARED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared" && pwd)"
source "$SHARED_DIR/install-lib.sh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../harnesses/claude-code" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC}  %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC}  %s\n" "$*" >&2; }
info() { printf "        %s\n" "$*"; }

DRY_RUN=0
PURGE=0
ASSUME_YES=0
FORCED_SCOPE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --purge)   PURGE=1; shift ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    --scope)   FORCED_SCOPE="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "unknown flag: $1"; exit 1 ;;
  esac
done

GLOBAL_TARGET="$HOME/.claude"
PROJECT_TARGET="$(furaide_find_project_dir ".claude")"
GLOBAL_RECEIPT="$GLOBAL_TARGET/.furaide-receipt.json"
PROJECT_RECEIPT="$PROJECT_TARGET/.furaide-receipt.json"

HAVE_GLOBAL=0; [[ -f "$GLOBAL_RECEIPT" ]] && HAVE_GLOBAL=1
HAVE_PROJECT=0; [[ -f "$PROJECT_RECEIPT" ]] && HAVE_PROJECT=1

# ── Step 1: Find receipt(s), pick scope if ambiguous ────────────────────────
if [[ -n "$FORCED_SCOPE" ]]; then
  case "$FORCED_SCOPE" in
    global)  TARGET_DIR="$GLOBAL_TARGET" ;;
    project) TARGET_DIR="$PROJECT_TARGET" ;;
    *) err "unknown --scope value: $FORCED_SCOPE (expected global|project)"; exit 1 ;;
  esac
elif [[ "$HAVE_GLOBAL" -eq 1 && "$HAVE_PROJECT" -eq 1 ]]; then
  printf '\nFound installs at both scopes. Which one to uninstall?\n\n' >&2
  printf '  1) Global   (%s)\n' "$GLOBAL_TARGET" >&2
  printf '  2) Project  (%s)\n\n' "$PROJECT_TARGET" >&2
  read -rp 'Enter 1 or 2: ' choice </dev/tty
  case "$choice" in
    1) TARGET_DIR="$GLOBAL_TARGET" ;;
    2) TARGET_DIR="$PROJECT_TARGET" ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
elif [[ "$HAVE_GLOBAL" -eq 1 ]]; then
  TARGET_DIR="$GLOBAL_TARGET"
elif [[ "$HAVE_PROJECT" -eq 1 ]]; then
  TARGET_DIR="$PROJECT_TARGET"
else
  err "No Furaidē install found (checked $GLOBAL_RECEIPT and $PROJECT_RECEIPT)."
  err "Run with --scope global|project if the install used a nonstandard location."
  exit 1
fi

RECEIPT_PATH="$TARGET_DIR/.furaide-receipt.json"
RECEIPT_JSON="$(furaide_read_receipt "$RECEIPT_PATH")"
if [[ -z "$RECEIPT_JSON" ]]; then
  err "No receipt found at $RECEIPT_PATH — nothing to uninstall."
  exit 1
fi

_receipt_field() {  # jq-style path (python fallback) -> value or empty
  printf '%s' "$RECEIPT_JSON" | python3 -c "
import json,sys
d = json.load(sys.stdin)
try:
    v = d
    for k in '$1'.split('.'):
        v = v[k] if not k.isdigit() else v[int(k)]
    print(v if isinstance(v,str) else json.dumps(v))
except Exception:
    print('')
" 2>/dev/null
}

INSTALLED_AT="$(_receipt_field installedAt)"
BACKUP_DIR="$(_receipt_field backupDir)"
BACKUP_DIR="${BACKUP_DIR//\"/}"
ok "found receipt: installed $INSTALLED_AT, target $TARGET_DIR"

remove() {  # path label
  local path="$1" label="${2:-$path}"
  if [[ -e "$path" || -L "$path" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf "[dry-run] would remove %s\n" "$label"
    else
      rm -rf "$path"
      ok "removed $label"
    fi
  fi
}

restore_or_remove() {  # dst backup_rel_path label
  local dst="$1" backup_rel="$2" label="$3"
  local backup_src="$BACKUP_DIR/$backup_rel"
  if [[ -n "$BACKUP_DIR" && -e "$backup_src" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf "[dry-run] would restore %s from backup\n" "$label"
    else
      cp "$backup_src" "$dst"
      ok "restored $label from backup"
    fi
  else
    remove "$dst" "$label"
  fi
}

# ── Step 2: Select what to remove (delete/skip only) ────────────────────────
DO_CLAUDE_MD=1
DO_SETTINGS=1
DO_AGENTS=1
DO_SKILLS=1
DO_IDISU=1
DO_REJION=1

if [[ "$ASSUME_YES" -ne 1 && "$DRY_RUN" -ne 1 ]]; then
  printf '\nWhat to remove from %s (Enter=delete, s=skip):\n\n' "$TARGET_DIR" >&2
  ask() {  # var_name label
    local __var="$1" __label="$2" __reply
    read -rp "  $__label [delete/s]: " __reply </dev/tty
    case "$__reply" in s|S) printf -v "$__var" '0' ;; *) printf -v "$__var" '1' ;; esac
  }
  ask DO_CLAUDE_MD "CLAUDE.md"
  ask DO_SETTINGS  "settings.json keys"
  ask DO_AGENTS    "agents/"
  ask DO_SKILLS    "skills/ symlinks (content in ~/.agents/skills/ preserved unless --purge)"
  ask DO_IDISU     "Idisu plugin"
  ask DO_REJION    "Rejion plugin"
fi

# ── Step 3: Execute ──────────────────────────────────────────────────────────
[[ "$DO_CLAUDE_MD" -eq 1 ]] && restore_or_remove "$TARGET_DIR/CLAUDE.md" "CLAUDE.md" "CLAUDE.md"

if [[ "$DO_SETTINGS" -eq 1 ]]; then
  src_settings="$REPO/config/settings.json"
  dst_settings="$TARGET_DIR/settings.json"
  if [[ -f "$dst_settings" && -f "$src_settings" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      keys=$(python3 -c "import json; print(', '.join(json.load(open('$src_settings')).keys()))" 2>/dev/null || echo "(see $src_settings)")
      printf "[dry-run] would remove settings.json keys: %s\n" "$keys"
    else
      python3 -c "
import json,sys
keys=list(json.load(open(sys.argv[1])).keys())
try: dst=json.load(open(sys.argv[2]))
except: sys.exit()
[dst.pop(k,None) for k in keys]
open(sys.argv[2],'w').write(json.dumps(dst,indent=2)+'\n')
" "$src_settings" "$dst_settings" 2>/dev/null && ok "removed settings.json keys from $dst_settings" \
        || warn "could not modify settings.json — remove keys from $dst_settings manually"
    fi
  fi
  [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]] && remove "$TARGET_DIR/statusline-command.sh" "statusline-command.sh symlink"
fi

if [[ "$DO_AGENTS" -eq 1 ]]; then
  agents="$(_receipt_field components.agents)"
  printf '%s' "$agents" | python3 -c "
import json,sys
try: paths = json.load(sys.stdin)
except: paths = []
for p in paths: print(p)
" 2>/dev/null | while IFS= read -r agent_path; do
    [[ -n "$agent_path" ]] && remove "$agent_path" "agents/$(basename "$agent_path")"
  done
fi

if [[ "$DO_SKILLS" -eq 1 ]]; then
  skill_names="$(_receipt_field components.skillNames)"
  printf '%s' "$skill_names" | python3 -c "
import json,sys
try: names = json.load(sys.stdin)
except: names = []
for n in names: print(n)
" 2>/dev/null | while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue
    if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
      remove "$HOME/.claude/skills/$skill_name" "~/.claude/skills/$skill_name (symlink only)"
      if [[ "$PURGE" -eq 1 ]]; then
        remove "$HOME/.agents/skills/$skill_name" "~/.agents/skills/$skill_name (--purge: shared pool content)"
      else
        info "~/.agents/skills/$skill_name content preserved (shared pool — pass --purge to remove)"
      fi
    else
      remove "$TARGET_DIR/skills/$skill_name" "$TARGET_DIR/skills/$skill_name"
    fi
  done
fi

if [[ "$DO_IDISU" -eq 1 ]]; then
  if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
    printf '\n[note] Idisu is a marketplace plugin — complete removal in Claude Code:\n'
    printf '  /plugin uninstall idisu@fr1d4y\n'
  else
    remove "$TARGET_DIR/skills/idisu" "$TARGET_DIR/skills/idisu (skills-dir plugin)"
  fi
fi

if [[ "$DO_REJION" -eq 1 ]]; then
  if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
    printf '  /plugin uninstall rejion@fr1d4y\n'
    printf '  /plugin marketplace remove fr1d4y\n'
  else
    remove "$TARGET_DIR/skills/rejion" "$TARGET_DIR/skills/rejion (skills-dir plugin)"
  fi
fi

# ── Purge (Idisu data + shared skill pool if requested) ─────────────────────
if [[ "$PURGE" -eq 1 && "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
  if [[ -d "$HOME/.idisu" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf "[dry-run] would remove ~/.idisu (--purge)\n"
    else
      SIZE=$(du -sh "$HOME/.idisu" 2>/dev/null | cut -f1 || echo "?")
      remove "$HOME/.idisu" "~/.idisu ($SIZE, --purge)"
    fi
  fi
fi

remove "$HOME/.github-setup-state-friday" "~/.github-setup-state-friday"

# ── Clean up backup dir and receipt ──────────────────────────────────────────
if [[ "$DRY_RUN" -ne 1 ]]; then
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rmdir "$BACKUP_DIR" 2>/dev/null && ok "removed now-empty backup dir $BACKUP_DIR" || true
  fi
  rm -f "$RECEIPT_PATH"
  ok "removed receipt $RECEIPT_PATH"
fi

printf "\n${GREEN}[done]${NC} Uninstall complete for %s.\n" "$TARGET_DIR"
[[ "$DRY_RUN" -eq 1 ]] && printf '%s\n' "[dry-run] No changes were made."
```

- [ ] **Step 2: Syntax-check**

Run: `bash -n packages/cli/src/targets/claude-code/uninstall.sh`
Expected: no output.

- [ ] **Step 3: Round-trip test — install then uninstall in an isolated scratch HOME**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/install.sh --yes
test -f "$SCRATCH_HOME/.claude/.furaide-receipt.json" && echo "INSTALL OK"

HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/uninstall.sh --yes
test ! -f "$SCRATCH_HOME/.claude/.furaide-receipt.json" && echo "RECEIPT REMOVED"
test ! -f "$SCRATCH_HOME/.claude/CLAUDE.md" && echo "CLAUDE.md REMOVED"
test ! -e "$SCRATCH_HOME/.claude/skills" -o -z "$(ls -A "$SCRATCH_HOME/.claude/skills" 2>/dev/null)" && echo "SKILL SYMLINKS REMOVED"
test -d "$SCRATCH_HOME/.agents/skills" && echo "SHARED POOL PRESERVED (no --purge)"
rm -rf "$SCRATCH_HOME"
```
Expected: all five markers print (`INSTALL OK`, `RECEIPT REMOVED`, `CLAUDE.md REMOVED`, `SKILL SYMLINKS REMOVED`, `SHARED POOL PRESERVED (no --purge)`) — confirming the shared `~/.agents/skills/` content survives a non-purge uninstall while the `~/.claude/skills/` symlinks are gone.

- [ ] **Step 4: Verify `--purge` removes the shared pool too**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/install.sh --yes
HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/uninstall.sh --yes --purge
test ! -d "$SCRATCH_HOME/.agents/skills/github" && echo "PURGE REMOVED SHARED POOL"
rm -rf "$SCRATCH_HOME"
```
Expected: `PURGE REMOVED SHARED POOL` prints.

- [ ] **Step 5: Verify graceful error when no receipt exists**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" bash packages/cli/src/targets/claude-code/uninstall.sh --yes 2>&1 | grep -q "No Furaidē install found" && echo "ERROR MESSAGE OK"
rm -rf "$SCRATCH_HOME"
```
Expected: `ERROR MESSAGE OK` prints (script exits 1, caught by the pipeline so the test itself doesn't fail the shell).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/targets/claude-code/uninstall.sh
git commit -m "$(cat <<'EOF'
feat(claude-code): receipt-driven uninstaller, symlink-only skill removal

Why: the previous uninstaller hardcoded the skill/agent list to remove,
so it silently missed anything installed after that list was written,
and unconditionally removed the .venv path left over from the
pre-rename Python mekiki pipeline (Īdisu is bun-based now). This
version reads the Phase 4 receipt, offers a scope picker when both
global and project installs exist, and removes only the
~/.claude/skills/<name> symlink — never the ~/.agents/skills/<name>
shared-pool content other harnesses may also depend on — unless
--purge is explicitly passed.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 5 checkpoint:** Claude Code install → uninstall round-trips cleanly in an isolated `HOME`, preserves the shared skill pool by default, and purges it only when asked.

---

## Phase 6 — OpenCode alignment

**Outcome:** `opencode-fleet`'s backup directory becomes `.furaide-backup/` (was `.kura_backup/`), its receipt filename becomes `.furaide-receipt.json` (was `.furaide-install-receipt.json`, with a read-time fallback so existing installs aren't orphaned), the interactive wizard defaults its project-scope suggestion to a CWD walk-up match instead of always `./​.opencode`, the wizard gains back-navigation, and external skills (`skills-manifest.json`) install to the shared `~/.agents/skills/` pool with a Claude Code symlink created per skill — instead of the OC-only `~/.config/opencode/skills/`.

**Files:**
- Modify: `packages/cli/src/targets/opencode-fleet/backup.ts`
- Modify: `packages/cli/src/targets/opencode-fleet/receipt.ts`
- Modify: `packages/cli/src/targets/opencode-fleet/install.ts`
- Modify: `packages/cli/src/targets/opencode-fleet/wizard.ts`
- Modify: `harnesses/opencode/config/skills-manifest.json`
- Modify: `harnesses/opencode/scripts/pull-external-skills.mjs`

### Task 6.1: Rename backup dir and receipt filename (with legacy read fallback)

- [ ] **Step 1: Update the constants in `backup.ts`**

Current lines 13–14:

```typescript
export const BACKUP_DIR_NAME = ".kura_backup";
export const RECEIPT_FILENAME = ".furaide-install-receipt.json";
```

Replace with:

```typescript
export const BACKUP_DIR_NAME = ".furaide-backup";
export const RECEIPT_FILENAME = ".furaide-receipt.json";
/** Read-only fallback so installs from before this rename aren't orphaned —
 * existingReceiptBackupRoot() and receipt.ts's readReceipt() both check this
 * name if the current RECEIPT_FILENAME isn't found. Never written to. */
export const LEGACY_RECEIPT_FILENAME = ".furaide-install-receipt.json";
```

- [ ] **Step 2: Make `existingReceiptBackupRoot` fall back to the legacy filename**

Current lines 31–42 in `backup.ts`:

```typescript
export function existingReceiptBackupRoot(targetDir: string): string | null {
  const receiptPath = join(targetDir, RECEIPT_FILENAME);
  if (!existsSync(receiptPath)) return null;
  try {
    const raw = readFileSync(receiptPath, "utf8");
    const parsed = JSON.parse(raw) as { backup?: { root?: string | null } };
    const root = parsed?.backup?.root;
    return typeof root === "string" && root.length > 0 ? root : null;
  } catch {
    return null;
  }
}
```

Replace with:

```typescript
export function existingReceiptBackupRoot(targetDir: string): string | null {
  let receiptPath = join(targetDir, RECEIPT_FILENAME);
  if (!existsSync(receiptPath)) {
    const legacyPath = join(targetDir, LEGACY_RECEIPT_FILENAME);
    if (!existsSync(legacyPath)) return null;
    receiptPath = legacyPath;
  }
  try {
    const raw = readFileSync(receiptPath, "utf8");
    const parsed = JSON.parse(raw) as { backup?: { root?: string | null } };
    const root = parsed?.backup?.root;
    return typeof root === "string" && root.length > 0 ? root : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Make `receipt.ts`'s `readReceipt` fall back to the legacy filename**

Current lines 16–56 in `receipt.ts`. First, update the import (line 12):

```typescript
import { RECEIPT_FILENAME } from "./backup.ts";

export { RECEIPT_FILENAME };
```

Replace with:

```typescript
import { RECEIPT_FILENAME, LEGACY_RECEIPT_FILENAME } from "./backup.ts";

export { RECEIPT_FILENAME };
```

Then replace the body of `readReceipt` (lines 25–56):

```typescript
export function readReceipt(targetDir: string): InstallReceiptV2 | null {
  const path = receiptPath(targetDir);
  if (!existsSync(path)) return null;
```

with:

```typescript
export function readReceipt(targetDir: string): InstallReceiptV2 | null {
  let path = receiptPath(targetDir);
  if (!existsSync(path)) {
    const legacyPath = join(targetDir, LEGACY_RECEIPT_FILENAME);
    if (!existsSync(legacyPath)) return null;
    path = legacyPath;
    process.stderr.write(
      `[furaide] note: reading receipt from legacy filename ${LEGACY_RECEIPT_FILENAME}. ` +
        `The next install/uninstall at this target will migrate it to ${RECEIPT_FILENAME}.\n`
    );
  }
```

(The rest of the function body — `raw = readFileSync(path, ...)` through the end — is unchanged; it already used the local `path` variable, which now correctly points at whichever filename was found.)

- [ ] **Step 4: Verify `deleteReceipt` also cleans up a legacy file if present**

Current lines 79–83 in `receipt.ts`:

```typescript
export function deleteReceipt(targetDir: string): void {
  const path = receiptPath(targetDir);
  if (!existsSync(path)) return;
  unlinkSync(path);
}
```

Replace with:

```typescript
export function deleteReceipt(targetDir: string): void {
  const path = receiptPath(targetDir);
  if (existsSync(path)) unlinkSync(path);
  const legacyPath = join(targetDir, LEGACY_RECEIPT_FILENAME);
  if (existsSync(legacyPath)) unlinkSync(legacyPath);
}
```

(Update the same import line in this file to also bring in `LEGACY_RECEIPT_FILENAME`, already done in Step 3.)

- [ ] **Step 5: Typecheck**

Run: `cd packages/cli && bun run typecheck`
Expected: `0 errors` (or equivalent tsc clean output).

- [ ] **Step 6: Migration round-trip test — legacy receipt is read, new receipt is written on next install**

Run:
```bash
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/target"
cat > "$SCRATCH/target/.furaide-install-receipt.json" <<'EOF'
{"version":2,"installedAt":"2025-01-01T00:00:00Z","targetDir":"PLACEHOLDER","scope":"custom","selectedWorkflows":[],"selectedAgents":[],"installedFilesByComponent":{},"backup":{"root":null,"created":false},"requiredSkills":{"external":[],"bundled":[]}}
EOF
python3 -c "
import json
p = '$SCRATCH/target/.furaide-install-receipt.json'
d = json.load(open(p))
d['targetDir'] = '$SCRATCH/target'
json.dump(d, open(p, 'w'))
"
cd packages/cli
bun run bin/furaide.ts uninstall opencode-fleet --scope custom --custom-dir "$SCRATCH/target" --yes 2>&1 | grep -q "legacy filename" && echo "LEGACY READ OK"
cd - >/dev/null
rm -rf "$SCRATCH"
```
Expected: `LEGACY READ OK` prints, confirming the legacy-filename note fires and the (empty-file-list) uninstall completes without error.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/targets/opencode-fleet/backup.ts packages/cli/src/targets/opencode-fleet/receipt.ts
git commit -m "$(cat <<'EOF'
refactor(opencode-fleet): rename backup dir and receipt to Furaidē-wide names

Why: claude-code and pi-agent installers (Phases 4/5) use .furaide-backup/
and .furaide-receipt.json; opencode-fleet used .kura_backup/ and
.furaide-install-receipt.json. Aligning the names makes the three
installers' on-disk footprint predictable from one convention. Existing
installs aren't orphaned: readReceipt() and existingReceiptBackupRoot()
both fall back to the legacy filename on read (never write it), so the
very next install or uninstall at that target self-migrates.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 6.2: CWD walk-up default for project scope

- [ ] **Step 1: Add a walk-up helper to `resolve.ts`**

In `packages/cli/src/targets/opencode-fleet/resolve.ts`, add this function after `harnessRootToRepoRoot` (after line 74):

```typescript
/** Walks up from `startDir` looking for an existing `.opencode` directory,
 * stopping at the nearest `.git` parent or filesystem root. Mirrors
 * packages/cli/src/shared/install-lib.sh's furaide_find_project_dir() for
 * the bash-based installers — kept as a separate TS implementation here
 * since opencode-fleet doesn't source that shell library. Always returns a
 * path (existing match, or `<repo-root-or-startDir>/.opencode` as a
 * not-yet-created default); never throws. */
export function findProjectScopeDir(startDir: string): string {
  let dir = resolvePath(startDir);
  let repoRoot: string | null = null;
  while (true) {
    if (existsSync(join(dir, ".opencode"))) return join(dir, ".opencode");
    if (repoRoot === null && existsSync(join(dir, ".git"))) repoRoot = dir;
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return join(repoRoot ?? startDir, ".opencode");
}
```

- [ ] **Step 2: Use it in `install.ts`'s `projectScope()`**

Current lines 31–33 in `install.ts`:

```typescript
export function projectScope(cwd: string = process.env.FURAIDE_INVOKED_FROM || process.cwd()): string {
  return join(cwd, ".opencode");
}
```

Replace with:

```typescript
export function projectScope(cwd: string = process.env.FURAIDE_INVOKED_FROM || process.cwd()): string {
  return findProjectScopeDir(cwd);
}
```

Add `findProjectScopeDir` to the existing `resolve.ts` import in `install.ts` (current line 14–20):

```typescript
import {
  resolveWorkflowClosure,
  resolveAgentScripts,
  resolveAgentSkills,
  resolveAdvancedClosure,
  buildAgentDelegationMap,
  listAllAgentNames,
} from "./resolve.ts";
```

Replace with:

```typescript
import {
  resolveWorkflowClosure,
  resolveAgentScripts,
  resolveAgentSkills,
  resolveAdvancedClosure,
  buildAgentDelegationMap,
  listAllAgentNames,
  findProjectScopeDir,
} from "./resolve.ts";
```

- [ ] **Step 3: Typecheck and unit-verify the walk-up behavior**

Run: `cd packages/cli && bun run typecheck`
Expected: `0 errors`.

Run:
```bash
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/repo/.git" "$SCRATCH/repo/sub/deeper" "$SCRATCH/repo/sub/.opencode"
cd packages/cli
bun -e "
import { findProjectScopeDir } from './src/targets/opencode-fleet/resolve.ts';
console.log(findProjectScopeDir('$SCRATCH/repo/sub/deeper'));
"
cd - >/dev/null
rm -rf "$SCRATCH"
```
Expected: prints `$SCRATCH/repo/sub/.opencode` — confirms the walk-up found the existing marker two levels up rather than defaulting to `sub/deeper/.opencode` or the repo root.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/targets/opencode-fleet/resolve.ts packages/cli/src/targets/opencode-fleet/install.ts
git commit -m "$(cat <<'EOF'
feat(opencode-fleet): walk up from CWD to find an existing .opencode/

Why: projectScope() always resolved to <cwd>/.opencode, so running the
installer from a subdirectory of an already-initialized project fleet
would offer to create a second, sibling .opencode/ instead of finding
the existing one. Mirrors the same walk-up behavior Phase 4 gives the
claude-code installer.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 6.3: Back-navigation in the interactive wizard

- [ ] **Step 1: Restructure `runInteractiveWizard` as a back-navigable step loop**

The current `runInteractiveWizard` in `wizard.ts` (lines 56–190) is linear top-to-bottom. Replace the whole function body between `intro(...)` (line 57) and the final `outro(...)` call (lines 181–189) with a step-indexed loop. Full replacement of lines 56–190:

```typescript
export async function runInteractiveWizard(): Promise<void> {
  intro("Furaide's Fleet -- OpenCode installer");

  const bunOk = commandExists("bun");
  const nodeOk = commandExists("node");
  const gitOk = commandExists("git");
  const opencodeOk = commandExists("opencode");

  note(
    [
      `bun:      ${bunOk ? "found" : "MISSING"}`,
      `node:     ${nodeOk ? "found" : "MISSING"}`,
      `git:      ${gitOk ? "found" : "MISSING"}`,
      `opencode: ${opencodeOk ? "found on PATH" : "not found -- install will proceed, but the fleet won't run until opencode is installed"}`,
    ].join("\n"),
    "Pre-checks"
  );

  if (!bunOk && !nodeOk) {
    cancel("Neither bun nor node was found on PATH. One is required to run this installer and the installed fleet's scripts.");
    process.exit(1);
  }

  const credentials = probeWebToolsCredentials();
  const BACK = Symbol("BACK");

  let scope: Scope | undefined;
  let targetDir = "";
  let selectedWorkflows: WorkflowId[] = [];
  let webTools = credentials.anyFound;

  let step: 1 | 2 | 3 = 1;
  while (step <= 3) {
    if (step === 1) {
      const scopeChoice = await select({
        message: "Where should Furaide's Fleet be installed?",
        options: [
          { value: "global" as const, label: "Global", hint: GLOBAL_SCOPE },
          { value: "project" as const, label: "Project", hint: projectScope() },
          { value: "custom" as const, label: "Custom directory" },
        ],
      });
      if (isCancel(scopeChoice)) bail();

      if (scopeChoice === "custom") {
        const customPath = await text({
          message: "Absolute path to install target: (leave empty to go back)",
          validate: (v) => (v === "" || isAbsolute(v) ? undefined : "Must be an absolute path"),
        });
        if (isCancel(customPath)) bail();
        if (customPath === "") continue; // stay on step 1
        scope = "custom";
        targetDir = customPath as string;
      } else {
        scope = scopeChoice as Scope;
        targetDir = resolveScopeDir(scope);
      }

      if (!checkWriteAccess(targetDir)) {
        cancel(`No write access to ${targetDir} (or its nearest existing parent directory). Choose a different scope or fix permissions.`);
        process.exit(1);
      }

      const existingReceipt: InstallReceiptV2 | null = readReceipt(targetDir);
      if (existingReceipt) {
        note(
          `An existing install was found at ${targetDir} (installed ${existingReceipt.installedAt}, ` +
            `workflows: ${existingReceipt.selectedWorkflows.join(", ") || "none"}).\n` +
            `This run will be treated as an UPDATE -- any file it overwrites is backed up first, reusing the original backup location.`,
          "Existing install detected"
        );
        selectedWorkflows = existingReceipt.selectedWorkflows;
      } else if (selectedWorkflows.length === 0) {
        selectedWorkflows = [...WORKFLOW_IDS];
      }

      step = 2;
      continue;
    }

    if (step === 2) {
      const workflowChoice = await multiselect({
        message: "Select workflows to install (core infrastructure is always included). Cancel (Ctrl+C is not back -- use Esc/empty submit per your terminal) to go back to scope.",
        options: [
          { value: BACK as unknown as WorkflowId, label: "← Go back to scope selection" },
          ...WORKFLOW_CATALOG.map((wf) => ({ value: wf.id, label: `${wf.label} (${wf.id})`, hint: wf.description })),
        ],
        initialValues: selectedWorkflows,
        required: false,
      });
      if (isCancel(workflowChoice)) bail();
      const picked = workflowChoice as unknown as Array<WorkflowId | typeof BACK>;
      if (picked.includes(BACK)) {
        step = 1;
        continue;
      }
      selectedWorkflows = picked as WorkflowId[];

      const webToolsChoice = await confirm({
        message: credentials.anyFound
          ? `Install Web Tools plugin (web_search / fetch_content / maps)? Detected credentials: ${credentials.found.join(", ")}.`
          : `Install Web Tools plugin (web_search / fetch_content / maps)? No provider credentials detected (${WEB_TOOLS_CREDENTIAL_ENV_VARS.join(", ")}) -- it will install but calls will fail until configured.`,
        initialValue: webTools,
      });
      if (isCancel(webToolsChoice)) bail();
      webTools = webToolsChoice as boolean;

      step = 3;
      continue;
    }

    if (step === 3) {
      const { agents } = resolveWorkflowClosure(selectedWorkflows);
      const scripts = resolveAgentScripts(agents, HARNESS_ROOT);
      const skills = resolveAgentSkills(agents, HARNESS_ROOT);
      const existingReceipt = readReceipt(targetDir);

      note(
        [
          `Target: ${targetDir} (${existingReceipt ? "update" : "fresh install"})`,
          `Workflows: ${selectedWorkflows.join(", ") || "(none -- core infra only)"}`,
          `Agents (${agents.length}): ${agents.join(", ")}`,
          `Scripts (${scripts.length}): ${scripts.join(", ") || "(none)"}`,
          `Bundled skills (${skills.bundled.length}): ${skills.bundled.join(", ") || "(none)"}`,
          `External skills referenced (${skills.external.length}, not auto-pulled): ${skills.external.join(", ") || "(none)"}`,
          `Web Tools: ${webTools ? "yes" : "no"}`,
          `Backups: any file this run overwrites is copied first to ${targetDir}/${BACKUP_DIR_NAME}/<timestamp-or-reused-root>`,
        ].join("\n"),
        "Install summary"
      );

      const proceedChoice = await select({
        message: "Proceed with install?",
        options: [
          { value: "yes" as const, label: "Yes, install" },
          { value: "back" as const, label: "← Go back to workflow selection" },
          { value: "cancel" as const, label: "Cancel" },
        ],
      });
      if (isCancel(proceedChoice) || proceedChoice === "cancel") bail();
      if (proceedChoice === "back") {
        step = 2;
        continue;
      }

      const s = spinner();
      s.start("Installing Furaide's Fleet...");
      let receipt: InstallReceiptV2;
      try {
        receipt = await performInstall({
          scope: scope!,
          targetDir,
          selectedWorkflows,
          webTools,
          harnessRoot: HARNESS_ROOT,
          repoRoot: REPO_ROOT,
          installTimestamp: makeInstallTimestamp(),
        });
        s.stop("Install complete.");
      } catch (err) {
        s.stop("Install failed.");
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      outro(
        [
          `Furaide's Fleet installed to ${targetDir}.`,
          `${receipt.selectedAgents.length} agent(s), ${receipt.requiredSkills.bundled.length} bundled skill(s).`,
          ``,
          `To uninstall later, run:`,
          `  furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes`,
        ].join("\n")
      );
      return;
    }
  }
}
```

(This uses a `Symbol("BACK")` sentinel cast through `unknown` for the multiselect step, since `@clack/prompts`' `multiselect` is generically typed over the options' `value` type — the cast keeps the sentinel usable as a real selectable option without widening `WorkflowId` itself. The `text` prompt's back-path uses an empty-string convention instead, since clack's `text` has no multi-option list to attach a sentinel to.)

- [ ] **Step 2: Typecheck**

Run: `cd packages/cli && bun run typecheck`
Expected: `0 errors`.

- [ ] **Step 3: Manual interactive smoke test**

Run: `cd packages/cli && bun run bin/furaide.ts install opencode-fleet` (no flags — launches the wizard)
Expected: at the workflow-selection step, selecting "← Go back to scope selection" returns to the scope prompt; at the confirm step, selecting "← Go back to workflow selection" returns to workflow selection with the prior picks still checked. Press Ctrl+C to exit without installing once back-navigation is confirmed working — do not complete a real install during this manual check.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/targets/opencode-fleet/wizard.ts
git commit -m "$(cat <<'EOF'
feat(opencode-fleet): add back-navigation to the interactive wizard

Why: a wrong scope pick or workflow selection meant restarting the
whole wizard from scratch (Ctrl+C, re-run). Restructures the linear
wizard into a 3-step loop (scope -> workflows+web-tools -> confirm)
with an explicit back option at each later step, matching the
back-navigable pattern used by the Phase 4 claude-code installer.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 6.4: Unified skill model — external skills migrate to `~/.agents/skills/`

- [ ] **Step 1: Update the install target in `skills-manifest.json`**

In `harnesses/opencode/config/skills-manifest.json`, change line 2:

```json
  "install_target": "~/.config/opencode/skills",
```

to:

```json
  "install_target": "~/.agents/skills",
```

- [ ] **Step 2: Add Claude Code symlink creation to `pull-external-skills.mjs`'s pull mode**

In `harnesses/opencode/scripts/pull-external-skills.mjs`, add a symlink helper near the top (after the `expandHome` function, currently ending at line 49):

```javascript
function symlinkToClaudeSkills(skillName, agentsPoolDir) {
  const claudeSkillsDir = expandHome('~/.claude/skills');
  const linkPath = join(claudeSkillsDir, skillName);
  const targetPath = join(agentsPoolDir, skillName);
  mkdirSync(claudeSkillsDir, { recursive: true });
  try {
    const stat = require('node:fs').lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      rmSync(linkPath, { force: true });
    } else {
      // A real (non-symlink) directory already exists — don't clobber it.
      return false;
    }
  } catch {
    // linkPath doesn't exist yet — proceed to create it.
  }
  require('node:fs').symlinkSync(targetPath, linkPath, 'dir');
  return true;
}
```

Add the required import at the top of the file (line 17, alongside the existing `node:fs` import):

```javascript
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, lstatSync, symlinkSync } from 'node:fs';
```

(This supersedes the inline `require('node:fs')` calls above — replace those two `require('node:fs').lstatSync` / `require('node:fs').symlinkSync` calls with the now-directly-imported `lstatSync` / `symlinkSync`.)

- [ ] **Step 3: Call the symlink helper after each skill copy in `pullMode`**

Current lines 176–191 in `pull-external-skills.mjs` (inside the `for (const skill of src.skills)` loop):

```javascript
        if (existsSync(srcDir)) {
          if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
          cpSync(srcDir, destDir, { recursive: true });
          log(`  copied ${skill}/ → ${installTarget}`);
        } else if (existsSync(srcFile)) {
          mkdirSync(destDir, { recursive: true });
          cpSync(srcFile, join(destDir, skill + '.md'));
          log(`  copied ${skill}.md → ${installTarget}/${skill}/`);
        } else {
          err(`  skill not found in repo: ${skill} (checked ${srcDir} and ${srcFile})`);
          continue;
        }

        receipt[skill] = { repo: src.repo, pin: src.pin, date };
```

Replace with:

```javascript
        if (existsSync(srcDir)) {
          if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
          cpSync(srcDir, destDir, { recursive: true });
          log(`  copied ${skill}/ → ${installTarget}`);
        } else if (existsSync(srcFile)) {
          mkdirSync(destDir, { recursive: true });
          cpSync(srcFile, join(destDir, skill + '.md'));
          log(`  copied ${skill}.md → ${installTarget}/${skill}/`);
        } else {
          err(`  skill not found in repo: ${skill} (checked ${srcDir} and ${srcFile})`);
          continue;
        }

        if (symlinkToClaudeSkills(skill, installTarget)) {
          log(`  symlinked ~/.claude/skills/${skill} → ${installTarget}/${skill}`);
        }

        receipt[skill] = { repo: src.repo, pin: src.pin, date };
```

(OpenCode itself reads `~/.agents/skills/` and `~/.claude/skills/` natively per its own docs — no OC-side change needed for OC to see these skills post-migration. Pi reads `~/.agents/skills/` natively too. Only Claude Code needs the explicit symlink, since it does not read `~/.agents/` on its own.)

- [ ] **Step 4: Migration note for existing installs — old location isn't auto-cleaned**

Add a comment above the `pullMode` function (before line 121) documenting the one-time manual step existing installs need:

```javascript
// NOTE (migration, one-time): skills pulled before this change live under
// ~/.config/opencode/skills/. This version's install_target is
// ~/.agents/skills/ (the shared cross-tool pool). Re-running --pull writes
// the new location; it does NOT delete the old ~/.config/opencode/skills/
// copy — remove that manually if desired, or leave it (OpenCode's own skill
// loader also reads ~/.config/opencode/skills/, so a stale copy there is
// inert, not harmful, once ~/.agents/skills/ has the current version).
```

- [ ] **Step 5: Run the manifest's `--check` mode to confirm the new target parses correctly**

Run: `node harnesses/opencode/scripts/pull-external-skills.mjs --check`
Expected: for each of the 23+3+3 skills, prints either `NOT INSTALLED` (expected on a machine that hasn't pulled to the new location yet) or `ok`/`DRIFT` — confirms `expandHome(manifest.install_target)` resolves to `~/.agents/skills` without error (script does not crash).

- [ ] **Step 6: Full pull + symlink verification in an isolated `HOME`**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" node harnesses/opencode/scripts/pull-external-skills.mjs --pull 2>&1 | tail -20
test -d "$SCRATCH_HOME/.agents/skills/brainstorming" && echo "PULLED TO AGENTS POOL"
test -L "$SCRATCH_HOME/.claude/skills/brainstorming" && echo "CC SYMLINK CREATED"
readlink "$SCRATCH_HOME/.claude/skills/brainstorming" | grep -q "$SCRATCH_HOME/.agents/skills/brainstorming" && echo "SYMLINK TARGET CORRECT"
rm -rf "$SCRATCH_HOME"
```
Expected: `PULLED TO AGENTS POOL`, `CC SYMLINK CREATED`, `SYMLINK TARGET CORRECT` all print. (This performs real `git clone` calls over the network to the 3 pinned repos — run only where network access to GitHub is available.)

- [ ] **Step 7: Commit**

```bash
git add harnesses/opencode/config/skills-manifest.json harnesses/opencode/scripts/pull-external-skills.mjs
git commit -m "$(cat <<'EOF'
feat(opencode): migrate external skills to the shared ~/.agents/skills/ pool

Why: opencode-fleet's 29 external skills (brainstorming, writing-plans,
diagnose, etc.) previously landed at ~/.config/opencode/skills/, an
OC-only location. OpenCode and Pi both read ~/.agents/skills/ natively
per their own docs; moving the install_target there makes the same
pull benefit all three harnesses. Claude Code doesn't read
~/.agents/ on its own, so pull-external-skills.mjs now creates a
~/.claude/skills/<name> symlink per skill (skipped if a real,
non-symlink directory already occupies that name — never clobbers).
Old copies at ~/.config/opencode/skills/ are left in place (inert, not
harmful) rather than auto-deleted.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 6 checkpoint:** opencode-fleet's naming matches claude-code/pi-agent, project scope resolves via walk-up, the wizard is back-navigable, and external skills join the shared `~/.agents/skills/` pool with automatic Claude Code symlinks.

---

## Phase 7 — OpenCode uninstall scope picker

**Outcome:** `furaide uninstall opencode-fleet` with no `--scope` flag no longer silently defaults to `project` and reports "nothing to uninstall" when the real install was global. It checks both scopes, uses the one that has a receipt, prompts when both do, and errors with a clear message (not a false "nothing to uninstall") when neither does but the user might have used a custom scope.

**Files:**
- Modify: `packages/cli/src/targets/opencode-fleet/uninstall.ts`

### Task 7.1: Add scope detection before defaulting

- [ ] **Step 1: Replace the scope-resolution block in `main()`**

Current lines 148–165 in `uninstall.ts`:

```typescript
export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const flags = parseFlags(argv);
  const scope: Scope = flags.scope ?? "project";
  if (scope === "custom" && (!flags.customDir || !isAbsolute(flags.customDir))) {
    throw new Error("--scope custom requires --custom-dir <absolute path>");
  }
  const targetDir = resolveScopeDir(scope, flags.customDir);

  const receipt = readReceipt(targetDir);
  if (!receipt) {
    process.stdout.write(`[furaide] No install receipt found at ${targetDir} -- nothing to uninstall.\n`);
    return;
  }
```

Replace with:

```typescript
export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const flags = parseFlags(argv);
  let scope: Scope;
  let targetDir: string;

  if (flags.scope) {
    scope = flags.scope;
    if (scope === "custom" && (!flags.customDir || !isAbsolute(flags.customDir))) {
      throw new Error("--scope custom requires --custom-dir <absolute path>");
    }
    targetDir = resolveScopeDir(scope, flags.customDir);
  } else {
    const globalDir = resolveScopeDir("global");
    const projectDir = resolveScopeDir("project");
    const hasGlobal = readReceipt(globalDir) !== null;
    const hasProject = readReceipt(projectDir) !== null;

    if (hasGlobal && hasProject) {
      if (flags.yes) {
        throw new Error(
          `Installs found at both global (${globalDir}) and project (${projectDir}) scope. ` +
            `Pass --scope global or --scope project to disambiguate under --yes.`
        );
      }
      const choice = await select({
        message: "Installs found at both scopes. Which one to uninstall?",
        options: [
          { value: "global" as const, label: "Global", hint: globalDir },
          { value: "project" as const, label: "Project", hint: projectDir },
        ],
      });
      if (isCancel(choice)) {
        cancel("Uninstall cancelled.");
        return;
      }
      scope = choice as Scope;
      targetDir = scope === "global" ? globalDir : projectDir;
    } else if (hasGlobal) {
      scope = "global";
      targetDir = globalDir;
    } else if (hasProject) {
      scope = "project";
      targetDir = projectDir;
    } else {
      process.stdout.write(
        `[furaide] No install receipt found at global (${globalDir}) or project (${projectDir}) scope.\n` +
          `[furaide] If this was installed with --scope custom, pass --scope custom --custom-dir <path>.\n`
      );
      return;
    }
  }

  const receipt = readReceipt(targetDir);
  if (!receipt) {
    process.stdout.write(`[furaide] No install receipt found at ${targetDir} -- nothing to uninstall.\n`);
    return;
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/cli && bun run typecheck`
Expected: `0 errors`.

- [ ] **Step 3: Verify both-scopes-found prompts correctly**

Run:
```bash
SCRATCH_GLOBAL_HOME=$(mktemp -d)
SCRATCH_PROJECT=$(mktemp -d)
git -C "$SCRATCH_PROJECT" init -q

# Fake a global install by planting a minimal valid receipt
mkdir -p "$SCRATCH_GLOBAL_HOME/.config/opencode"
cat > "$SCRATCH_GLOBAL_HOME/.config/opencode/.furaide-receipt.json" <<EOF
{"version":2,"installedAt":"2025-01-01T00:00:00Z","targetDir":"$SCRATCH_GLOBAL_HOME/.config/opencode","scope":"global","selectedWorkflows":[],"selectedAgents":[],"installedFilesByComponent":{},"backup":{"root":null,"created":false},"requiredSkills":{"external":[],"bundled":[]}}
EOF
mkdir -p "$SCRATCH_PROJECT/.opencode"
cat > "$SCRATCH_PROJECT/.opencode/.furaide-receipt.json" <<EOF
{"version":2,"installedAt":"2025-01-02T00:00:00Z","targetDir":"$SCRATCH_PROJECT/.opencode","scope":"project","selectedWorkflows":[],"selectedAgents":[],"installedFilesByComponent":{},"backup":{"root":null,"created":false},"requiredSkills":{"external":[],"bundled":[]}}
EOF

cd packages/cli
HOME="$SCRATCH_GLOBAL_HOME" FURAIDE_INVOKED_FROM="$SCRATCH_PROJECT" \
  bun run bin/furaide.ts uninstall opencode-fleet --yes 2>&1 | grep -q "Installs found at both" && echo "AMBIGUITY DETECTED UNDER --yes"
cd - >/dev/null
rm -rf "$SCRATCH_GLOBAL_HOME" "$SCRATCH_PROJECT"
```
Expected: `AMBIGUITY DETECTED UNDER --yes` prints (the `--yes` + both-scopes-found path throws the disambiguation error rather than silently picking one).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/targets/opencode-fleet/uninstall.ts
git commit -m "$(cat <<'EOF'
fix(opencode-fleet): detect scope ambiguity instead of defaulting to project

Why: uninstall with no --scope flag always resolved to "project", so a
global install left "nothing to uninstall" behind with no hint the
real install was elsewhere. Now checks both scopes' receipts first:
one found -> use it silently; both found -> prompt (or error under
--yes, since silently picking one would be equally wrong); neither
found -> point at --scope custom as the remaining possibility.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 7 checkpoint:** `furaide uninstall opencode-fleet` never silently misses an install at the "other" scope.

---

## Phase 8 — Pi Agent alignment

**Outcome:** `pi-agent`'s installer supports npm as a bun fallback (via `install-lib.sh`), auto-copies the example config on first install, and prints a note that shared skills need no extra step. `pi-agent` gains a real uninstall script (previously the router just printed manual instructions) that checks the `pi` CLI is present, runs `pi uninstall friday-furaidee`, and offers to clean up the leftover config directory.

**Files:**
- Modify: `packages/cli/src/targets/pi-agent/install.sh`
- Create: `packages/cli/src/targets/pi-agent/uninstall.sh`
- Modify: `packages/cli/src/router.ts`

### Task 8.1: Installer alignment (dual runtime, config copy, shared-skill note)

- [ ] **Step 1: Replace `packages/cli/src/targets/pi-agent/install.sh` in full**

```bash
#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. pi-agent installer
#
# Usage:
#   bash packages/cli/src/targets/pi-agent/install.sh
#
# Prerequisites: bun or node+npm, and the pi CLI (https://pi.dev)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_DIR="$(cd "$SCRIPT_DIR/../../shared" && pwd)"
source "$SHARED_DIR/install-lib.sh"
AGENT_DIR="$(cd "$SCRIPT_DIR/../../../../../harnesses/pi-agent" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
  esac
done

# ── Pre-checks ────────────────────────────────────────────────────────────────
furaide_detect_js_runtime || exit 1
ok "JS runtime: $JS_RUNTIME"

if ! command -v pi >/dev/null 2>&1; then
  err "pi CLI not found. Install from https://pi.dev then re-run."
  exit 1
fi
ok "pi CLI found"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would run: ($PKG_INSTALL) in $AGENT_DIR"
  echo "[dry-run] would run: pi install $AGENT_DIR"
  echo "[dry-run] would copy config/system.example.yml -> ~/.pi/agent/extensions/friday/config/system.yml (if not present)"
  exit 0
fi

# ── Install dependencies ──────────────────────────────────────────────────────
if [[ "$JS_RUNTIME" == "bun" ]]; then
  ( cd "$AGENT_DIR" && bun install )
else
  ( cd "$AGENT_DIR" && npm install )
fi
ok "dependencies installed ($JS_RUNTIME)"

# ── Register extension with Pi ────────────────────────────────────────────────
pi install "$AGENT_DIR"
ok "pi-agent registered with Pi"

# ── Copy example config on first install ─────────────────────────────────────
CONFIG_DEST="$HOME/.pi/agent/extensions/friday/config"
if [[ -f "$AGENT_DIR/config/system.example.yml" && ! -f "$CONFIG_DEST/system.yml" ]]; then
  mkdir -p "$CONFIG_DEST"
  cp "$AGENT_DIR/config/system.example.yml" "$CONFIG_DEST/system.yml"
  ok "copied example config -> $CONFIG_DEST/system.yml"
fi

printf '\n%s\n' "Done. Restart Pi for the extension to take effect."
printf '%s\n' "Themes available: friday, chimu"
printf '%s\n' "Skills from ~/.agents/skills/ are automatically available (no copy step needed)."
printf '%s\n' "Edit $CONFIG_DEST/system.yml to configure quota limits and provider keys."
```

- [ ] **Step 2: Syntax-check**

Run: `bash -n packages/cli/src/targets/pi-agent/install.sh`
Expected: no output.

- [ ] **Step 3: Dry-run smoke test**

Run: `bash packages/cli/src/targets/pi-agent/install.sh --dry-run`
Expected (assuming `pi` is not installed in this environment — the common case for CI/dev boxes without Pi): prints `[error] pi CLI not found...` and exits 1, confirming the pre-check gate fires before any dry-run output. If `pi` IS installed, expected output is the three `[dry-run]` lines with no actual `pi install` invocation.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/targets/pi-agent/install.sh
git commit -m "$(cat <<'EOF'
feat(pi-agent): npm fallback, config auto-copy, shared-skill note

Why: the installer required bun specifically; it now falls back to
npm+node via the shared install-lib.sh, matching claude-code and the
top-level wrappers. It also auto-copies config/system.example.yml on
first install (previously a README-documented manual step) and prints
a note that ~/.agents/skills/ content is already available with no
extra step, since Pi reads that pool natively.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 8.2: Real uninstall script + router wiring

- [ ] **Step 1: Create `packages/cli/src/targets/pi-agent/uninstall.sh`**

```bash
#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. pi-agent uninstaller
#
# Usage:
#   bash packages/cli/src/targets/pi-agent/uninstall.sh
#   bash packages/cli/src/targets/pi-agent/uninstall.sh --yes
#   bash packages/cli/src/targets/pi-agent/uninstall.sh --dry-run

set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)  ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
  esac
done

if ! command -v pi >/dev/null 2>&1; then
  err "pi CLI not found on PATH. Cannot uninstall without it — install pi first (https://pi.dev), then re-run."
  exit 1
fi
ok "pi CLI found"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would run: pi uninstall friday-furaidee"
  echo "[dry-run] would check ~/.pi/agent/extensions/friday/config/ for leftover files"
  exit 0
fi

pi uninstall friday-furaidee
ok "pi-agent unregistered from Pi"

CONFIG_DIR="$HOME/.pi/agent/extensions/friday/config"
if [[ -d "$CONFIG_DIR" ]]; then
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    rm -rf "$CONFIG_DIR"
    ok "removed $CONFIG_DIR"
  else
    printf 'Remove leftover config at %s? [y/N] ' "$CONFIG_DIR"
    read -r reply </dev/tty || reply="n"
    case "$reply" in
      y|Y) rm -rf "$CONFIG_DIR"; ok "removed $CONFIG_DIR" ;;
      *)   printf '        kept %s\n' "$CONFIG_DIR" ;;
    esac
  fi
fi

printf '\n%s\n' "Shared skills in ~/.agents/skills/ are not removed here — they are"
printf '%s\n' "managed by the claude-code or opencode-fleet uninstall flow."
```

- [ ] **Step 2: Syntax-check**

Run: `bash -n packages/cli/src/targets/pi-agent/uninstall.sh`
Expected: no output.

- [ ] **Step 3: Wire it into `router.ts`**

Current lines 21–31 in `packages/cli/src/router.ts`:

```typescript
type ShellTarget = Exclude<Target, "opencode-fleet">;

const SHELL_TARGET_SCRIPTS: Record<ShellTarget, { install: string; uninstall?: string }> = {
  "claude-code": {
    install: join(__dirname, "targets", "claude-code", "install.sh"),
    uninstall: join(__dirname, "targets", "claude-code", "uninstall.sh"),
  },
  "pi-agent": {
    install: join(__dirname, "targets", "pi-agent", "install.sh"),
  },
};
```

Replace with:

```typescript
type ShellTarget = Exclude<Target, "opencode-fleet">;

const SHELL_TARGET_SCRIPTS: Record<ShellTarget, { install: string; uninstall?: string }> = {
  "claude-code": {
    install: join(__dirname, "targets", "claude-code", "install.sh"),
    uninstall: join(__dirname, "targets", "claude-code", "uninstall.sh"),
  },
  "pi-agent": {
    install: join(__dirname, "targets", "pi-agent", "install.sh"),
    uninstall: join(__dirname, "targets", "pi-agent", "uninstall.sh"),
  },
};
```

Now remove the now-obsolete special-case block. Current lines 63–70:

```typescript
  if (resolvedTarget === "pi-agent" && resolvedAction === "uninstall") {
    process.stdout.write(
      "pi-agent has no bundled uninstaller — remove it via Pi's own extension management:\n" +
      "  pi extensions list\n" +
      "  pi uninstall friday-furaidee\n"
    );
    return;
  }

  const scripts = SHELL_TARGET_SCRIPTS[resolvedTarget];
```

Replace with:

```typescript
  const scripts = SHELL_TARGET_SCRIPTS[resolvedTarget];
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/cli && bun run typecheck`
Expected: `0 errors`.

- [ ] **Step 5: Verify the router now dispatches pi-agent uninstall to the real script**

Run: `bun run packages/cli/bin/furaide.ts uninstall pi-agent --dry-run 2>&1`
Expected (assuming `pi` is not installed): `[error] pi CLI not found on PATH...` — confirms dispatch reached the new script (not the old hardcoded message, which mentioned `pi extensions list` instead).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/targets/pi-agent/uninstall.sh packages/cli/src/router.ts
git commit -m "$(cat <<'EOF'
feat(pi-agent): add a real uninstall script, remove router special-case

Why: pi-agent uninstall previously just printed manual `pi uninstall`
instructions with no prerequisite check. Now it verifies the pi CLI is
on PATH (hard error if not — nothing else can proceed), runs the
uninstall itself, and offers to clean up the leftover config
directory Pi's own uninstall doesn't touch.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 8 checkpoint:** pi-agent installs with either bun or npm, and has a real, prerequisite-checked uninstall path dispatched through the router like the other two targets.

---

## Phase 8.5 — Close remaining global-flag gaps

**Outcome:** the locked global-flags list (`--dry-run`, `--skip-checks`) applies uniformly to all three targets. Phases 4/5/8 already gave `--dry-run` to claude-code and pi-agent; this phase adds it to `opencode-fleet` (which had no dry-run concept at all) and adds `--skip-checks` everywhere (suppresses non-fatal pre-check warnings — `jq`/`flock`/`git`/`opencode` missing — without touching the fail-fast errors for `bun`+`npm` both absent).

**Files:**
- Modify: `packages/cli/src/targets/opencode-fleet/wizard.ts`
- Modify: `packages/cli/src/targets/opencode-fleet/install.ts`
- Modify: `packages/cli/src/targets/claude-code/install.sh`
- Modify: `packages/cli/src/targets/pi-agent/install.sh`

### Task 8.5.1: `--dry-run` for opencode-fleet

- [ ] **Step 1: Add the flag to `NonInteractiveFlags` and its parser in `install.ts`**

Current lines 192–199 in `install.ts`:

```typescript
export interface NonInteractiveFlags {
  scope?: Scope;
  customDir?: string;
  workflows?: string;
  agents?: string;
  webTools?: boolean;
  yes?: boolean;
}
```

Wait — this interface actually lives in `wizard.ts` (confirmed: `wizard.ts` line 192, not `install.ts`). Replace it there instead:

```typescript
export interface NonInteractiveFlags {
  scope?: Scope;
  customDir?: string;
  workflows?: string;
  agents?: string;
  webTools?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}
```

- [ ] **Step 2: Add `--dry-run` to the flag parser in `install.ts`'s `parseFlags`**

Current lines 324–355 in `install.ts`, inside the `switch (arg)` block, add a new case (after the `--yes` case, before `default`):

```typescript
      case "--yes":
        flags.yes = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      default:
```

- [ ] **Step 3: Short-circuit before file writes in `runNonInteractive` (`wizard.ts`)**

Current end of `runNonInteractive` in `wizard.ts` (lines 240–256):

```typescript
  process.stdout.write(`[furaide] Installing opencode-fleet to ${targetDir} (scope=${scope})...\n`);

  const receipt = await performInstall({
    scope,
    targetDir,
    selectedWorkflows,
    advancedAgents,
    webTools,
    harnessRoot: HARNESS_ROOT,
    repoRoot: REPO_ROOT,
    installTimestamp: makeInstallTimestamp(),
  });

  process.stdout.write(
    `[furaide] Install complete. ${receipt.selectedAgents.length} agent(s) installed to ${targetDir}.\n` +
      `[furaide] To uninstall: furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes\n`
  );
}
```

Replace with:

```typescript
  const { agents: previewAgents } = advancedAgents && advancedAgents.length > 0
    ? { agents: advancedAgents }
    : resolveWorkflowClosure(selectedWorkflows);

  if (flags.dryRun) {
    process.stdout.write(
      `[dry-run] would install opencode-fleet to ${targetDir} (scope=${scope})\n` +
        `[dry-run] agents (${previewAgents.length}): ${previewAgents.join(", ")}\n` +
        `[dry-run] web tools: ${webTools ? "yes" : "no"}\n` +
        `[dry-run] no changes made.\n`
    );
    return;
  }

  process.stdout.write(`[furaide] Installing opencode-fleet to ${targetDir} (scope=${scope})...\n`);

  const receipt = await performInstall({
    scope,
    targetDir,
    selectedWorkflows,
    advancedAgents,
    webTools,
    harnessRoot: HARNESS_ROOT,
    repoRoot: REPO_ROOT,
    installTimestamp: makeInstallTimestamp(),
  });

  process.stdout.write(
    `[furaide] Install complete. ${receipt.selectedAgents.length} agent(s) installed to ${targetDir}.\n` +
      `[furaide] To uninstall: furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes\n`
  );
}
```

- [ ] **Step 4: Update `printHelp()` in `install.ts` to document the new flag**

Current line 370 in `install.ts` (inside the flags list):

```typescript
      "  --yes                              Required to confirm a non-interactive run",
```

Replace with:

```typescript
      "  --yes                              Required to confirm a non-interactive run",
      "  --dry-run                          Print what would be installed, make no changes",
```

- [ ] **Step 5: Typecheck and verify**

Run: `cd packages/cli && bun run typecheck`
Expected: `0 errors`.

Run:
```bash
SCRATCH=$(mktemp -d)
cd packages/cli
bun run bin/furaide.ts install opencode-fleet --scope custom --custom-dir "$SCRATCH" --yes --dry-run 2>&1 | grep -q "\[dry-run\] would install" && echo "OC DRY-RUN OK"
cd - >/dev/null
test ! -f "$SCRATCH/.furaide-receipt.json" && echo "NO FILES WRITTEN"
rm -rf "$SCRATCH"
```
Expected: `OC DRY-RUN OK` and `NO FILES WRITTEN` both print.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/targets/opencode-fleet/wizard.ts packages/cli/src/targets/opencode-fleet/install.ts
git commit -m "$(cat <<'EOF'
feat(opencode-fleet): add --dry-run to the non-interactive install path

Why: claude-code and pi-agent both gained --dry-run in earlier phases;
opencode-fleet had no equivalent, leaving one of the three targets
unable to preview an install. Prints the resolved agent closure and
scope without calling performInstall(), so no files are touched.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

### Task 8.5.2: `--skip-checks` everywhere

- [ ] **Step 1: Add the flag to `claude-code/install.sh`**

In `packages/cli/src/targets/claude-code/install.sh` (from Phase 4), find the flag-parsing `while` loop and add a case. Current relevant lines (from Phase 4's Step 1):

```bash
    --scope)       FORCED_SCOPE="$2"; shift 2 ;;
    --js-runtime)  FORCED_RUNTIME="$2"; shift 2 ;;
```

Add immediately after:

```bash
    --skip-checks) SKIP_CHECKS=1; shift ;;
```

Add the variable to the flag-defaults block alongside `FORCED_SCOPE`/`FORCED_RUNTIME`:

```bash
FORCED_SCOPE=""
FORCED_RUNTIME=""
SKIP_CHECKS=0
```

Then gate the pre-checks warning block (Phase 4's "Step 2: Pre-checks" section) behind it:

```bash
# ── Step 2: Pre-checks ───────────────────────────────────────────────────────
[[ "$JS_RUNTIME" == "npm" ]] && warn "bun not found — Īdisu CLI (bun:sqlite) will not install; falling back for skills/agents/config only."
if [[ "$SKIP_CHECKS" -ne 1 ]]; then
  command -v jq    >/dev/null 2>&1 || warn "jq not found - Īdisu hooks and settings merge fall back to python3."
  command -v flock >/dev/null 2>&1 || warn "flock not found - Īdisu hooks expect flock from util-linux."
  command -v git    >/dev/null 2>&1 || warn "git not found - statusline branch display will be blank."
fi
```

(This replaces the three unconditional `command -v ... || warn ...` lines from Phase 4 Step 1's "Step 1: Scope selection" section — locate them by the exact warning text and wrap them in the `if` block above.)

- [ ] **Step 2: Add the same flag to `pi-agent/install.sh`**

In `packages/cli/src/targets/pi-agent/install.sh` (from Phase 8), there are no non-fatal warnings to skip — both `bun`/`npm` absence and `pi` CLI absence are hard errors (`err` + `exit 1`), matching the locked spec's note that `--skip-checks` bypasses warnings, not fail-fast errors. No code change needed here; add a line to the header comment block documenting this explicitly:

```bash
#   --skip-checks     N/A here — pi-agent has no non-fatal pre-checks to skip
#                     (bun/npm and pi CLI absence are both hard errors)
```

- [ ] **Step 3: Verify `claude-code/install.sh --skip-checks` suppresses warnings**

Run:
```bash
SCRATCH_HOME=$(mktemp -d)
OUT=$(HOME="$SCRATCH_HOME" PATH="/usr/bin:/bin" bash packages/cli/src/targets/claude-code/install.sh --yes --skip-checks --dry-run 2>&1)
echo "$OUT" | grep -q "flock not found" && echo "FAIL: warning not suppressed" || echo "SKIP-CHECKS OK"
rm -rf "$SCRATCH_HOME"
```
(This test's reliability depends on `flock` genuinely being absent from a trimmed `PATH` — if the test environment has `flock` at `/bin/flock` or `/usr/bin/flock`, use a more restrictive `PATH` or skip this specific assertion and instead just confirm the script doesn't error with `--skip-checks` set: `echo "$OUT" | grep -q "\[dry-run\]" && echo "RAN OK WITH SKIP-CHECKS"`.)

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/targets/claude-code/install.sh packages/cli/src/targets/pi-agent/install.sh
git commit -m "$(cat <<'EOF'
feat(installers): add --skip-checks to suppress non-fatal pre-check warnings

Why: closes the last gap in the locked global-flags list. Only
claude-code has non-fatal warnings to suppress (jq/flock/git missing);
pi-agent's checks are all fail-fast by nature (bun+npm absent, or pi
CLI absent) so --skip-checks is a documented no-op there rather than
silently accepted and ignored.

Assisted-by: Claude Code claude-sonnet-5 <noreply@anthropic.com>
EOF
)"
```

**Phase 8.5 checkpoint:** the full locked global-flags list (`--yes`, `--dry-run`, `--purge`, `--scope`, `--js-runtime`, `--skip-checks`, `-h`/`--help`) is honored consistently across all three targets, with N/A cases documented rather than silently unsupported.

---

## Phase 9 — Full-suite verification and final green check

**Outcome:** every test suite touched by Phases 1–8 passes together, the top-level picker works for all three targets, and no target's install/uninstall leaves stray files in an isolated scratch environment.

**Files:** none (verification only).

### Task 9.1: Run every test suite

- [ ] **Step 1: Statusline suites**

```bash
bash harnesses/claude-code/tests/statusline/test_sidecar_fold.sh
bash harnesses/claude-code/tests/statusline/test_transcript_tail.sh
bash harnesses/claude-code/tests/statusline/test_display_v2.sh
```
Expected: `=== Results: N passed, 0 failed ===` for all three.

- [ ] **Step 2: Shared install-lib suite**

```bash
bash packages/cli/src/shared/tests/test_install_lib.sh
```
Expected: `=== Results: N passed, 0 failed ===`

- [ ] **Step 3: TypeScript typecheck across the whole CLI package**

```bash
cd packages/cli && bun run typecheck
```
Expected: `0 errors`.

- [ ] **Step 4: Any existing opencode-fleet or rejion test suites (regression check — not modified by this plan, must still be green)**

```bash
find "$(git rev-parse --show-toplevel)" -path '*/opencode-fleet/*' -iname '*.test.ts' -o -path '*/opencode-fleet/*' -iname '*test*.ts' 2>/dev/null
```
If any test files are found under `opencode-fleet/`, run them with `bun test <path>` and confirm all pass — Phases 6/7 touched `backup.ts`, `receipt.ts`, `install.ts`, `wizard.ts`, `uninstall.ts`, `resolve.ts`; any pre-existing unit tests for these files must still be green after the renames/additions.

### Task 9.2: End-to-end round-trip for all three targets, all scopes

- [ ] **Step 1: Claude Code, global scope, isolated HOME**

```bash
SCRATCH_HOME=$(mktemp -d)
HOME="$SCRATCH_HOME" bash scripts/install.sh claude-code --yes
HOME="$SCRATCH_HOME" bash scripts/uninstall.sh claude-code --yes
find "$SCRATCH_HOME/.claude" -type f 2>/dev/null
rm -rf "$SCRATCH_HOME"
```
Expected: the `find` after uninstall prints nothing but possibly `settings.json` (settings merge/unmerge is key-based, not whole-file — an empty or near-empty `settings.json` may remain, which is correct: other tools might have added keys to the same file).

- [ ] **Step 2: OpenCode, project scope, isolated HOME + scratch repo**

```bash
SCRATCH_HOME=$(mktemp -d)
SCRATCH_REPO=$(mktemp -d)
git -C "$SCRATCH_REPO" init -q
cd "$SCRATCH_REPO"
HOME="$SCRATCH_HOME" bash "$OLDPWD/scripts/install.sh" opencode-fleet --scope project --yes
test -f "$SCRATCH_REPO/.opencode/.furaide-receipt.json" && echo "OC INSTALL OK"
HOME="$SCRATCH_HOME" bash "$OLDPWD/scripts/uninstall.sh" opencode-fleet --scope project --yes
test ! -f "$SCRATCH_REPO/.opencode/.furaide-receipt.json" && echo "OC UNINSTALL OK"
cd "$OLDPWD"
rm -rf "$SCRATCH_HOME" "$SCRATCH_REPO"
```
Expected: `OC INSTALL OK` and `OC UNINSTALL OK` both print. (Run from the repo root so `$OLDPWD` resolves correctly; adjust the relative path if invoking from elsewhere.)

- [ ] **Step 3: Pi Agent — prerequisite-gate check only (no real Pi install assumed in CI)**

```bash
bash scripts/install.sh pi-agent --dry-run 2>&1 | tail -5
bash scripts/uninstall.sh pi-agent --dry-run 2>&1 | tail -5
```
Expected: both either show `[dry-run]` lines (if `pi` is present) or a clear `pi CLI not found` error (if absent) — never a crash or unhandled exception either way.

- [ ] **Step 4: Top-level picker smoke test for all three targets**

```bash
printf '1\n' | bash scripts/install.sh --dry-run-note-not-supported-here 2>&1 | head -3 || true
```
This flag doesn't exist — replace with a real interactive check: run `bash scripts/install.sh` with stdin piped from a here-string selecting each of the 3 menu options in turn, confirming each reaches its target's own flag-parsing (which then errors cleanly on the unrecognized trailing input rather than hanging):
```bash
printf '1\n' | timeout 5 bash scripts/install.sh || true
printf '2\n' | timeout 5 bash scripts/install.sh || true
printf '3\n' | timeout 5 bash scripts/install.sh || true
```
Expected: each of the three exits (via `timeout`, since a real full install shouldn't run unattended here) after printing evidence it reached the corresponding target script — the picker itself worked; full completion isn't required for this smoke check.

### Task 9.3: Final commit

- [ ] **Step 1: Confirm working tree is clean (all phase commits landed)**

Run: `git status --short`
Expected: no output (everything committed phase-by-phase already; this step is a final sanity check before declaring the plan complete).

- [ ] **Step 2: Tag the completion point (optional, only if the user's workflow uses tags)**

Skip unless explicitly requested — this plan does not assume tagging conventions beyond what `hanko--git-seal`'s `Skill(github)` recipes already cover.

**Phase 9 checkpoint — plan complete.** Statusline shows correct, bounded values. All three harness installers share one predictable UX: top-level picker, CWD walk-up scope, dual bun/npm, in-target backups, back-navigable wizards, receipt-driven uninstalls, and one shared `~/.agents/skills/` pool. Documentation refresh (README/CLAUDE.md/AGENTS.md content updates) is the next plan, written after this one ships.
