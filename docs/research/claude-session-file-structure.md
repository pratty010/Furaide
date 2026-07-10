# Claude Code session-file structure — research report

> Durable reference for any feature that parses Claude Code's local session transcripts to extract data.
> Evidence base: a full audit of every transcript under `~/.claude/projects/` on 2026-07-10 (10 main sessions + 376 subagent transcripts, 386 files total, ~18.3k assistant records + ~11k user records).
> Companion spec: `docs/superpowers/specs/2026-07-10-statusline-token-cost-fixes.md`. Pricing source: `https://platform.claude.com/docs/en/about-claude/pricing` (fetched 2026-07-10).

---

## 1. Layout & location

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl              # main session transcript
~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<id>.jsonl   # per-subagent transcript
```

- **One project dir per working directory.** The dir name is the CWD with every `/` replaced by `-` and a leading `-` prepended. Examples (observed):
  - `/d/Everything/Furaidē` → `-d-Everything-Furaid-` *(the trailing `ē` is dropped — non-ASCII handling is lossy)*
  - `/home/ace/.config/opencode` → `-home-ace--config-opencode` *(the `.` → `-`, producing a double `--`)*
  - `/d/Everything/F-R-I-D-A-Y` → `-d-Everything-F-R-I-D-A-Y-`
- **Only top-level `*.jsonl` files are main sessions.** Subagent transcripts always live under a parent session's `subagents/` dir and never get their own sidecar. A `find … -maxdepth 2 -name '*.jsonl' -not -path '*/subagents/*'` enumerates exactly the main sessions.
- **Empty project dirs exist** (e.g. `-d-Everything-Profile/`, `-home-ace-Downloads/`) — created when Claude Code was launched from that CWD but no session was persisted. Enumerate with a file-existence guard, don't assume every project dir has sessions.
- **Audit totals:** 10 main sessions, 376 subagent transcripts, all under `-d-Everything-Furaid-`. The 5 other project dirs held 0 main sessions.

---

## 2. Record types

Every line in a `.jsonl` transcript is one JSON record with a `.type` field. Census across all 386 transcripts:

| `.type` | count | carries usage? | notes |
|---|---|---|---|
| `assistant` | 18286 | **yes** (`message.usage`) | the only billable record type; one line per content block of a single API response |
| `user` | 11007 | no | user messages AND tool_result records (subagent completions surface here — see §5) |
| `attachment` | 1574 | no | file/pasted-content metadata |
| `system` | 1026 | no | system-level events |
| `mode` | 1019 | no | mode transitions |
| `permission-mode` | 1015 | no | permission mode changes |
| `last-prompt` | 1014 | no | prompt metadata |
| `bridge-session` | 990 | no | session bridge/relink events |
| `agent-name` | 688 | no | subagent display-name assignments |
| `custom-title` | 669 | no | user-set session titles |
| `queue-operation` | 615 | no | queued action records |
| `file-history-snapshot` | 579 | no | file-state checkpoints |
| `ai-title` | 96 | no | auto-generated session titles |

**Parser rule:** filter to `.type == "assistant"` for any token/cost/usage extraction. Everything else is metadata or user-side.

---

## 3. Assistant record anatomy & the dedup invariant

```jsonc
{
  "type": "assistant",
  "message": {
    "id": "msg_01XYZ...",           // dedup key — see invariant
    "model": "claude-sonnet-5",      // exact model id — see §9
    "usage": { ... },                // the billable payload — see §4
    "content": [                     // one OR MORE blocks per line
      { "type": "thinking", ... },
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "toolu_...", "name": "...", "input": {...} }
    ]
  }
}
```

**Content-block types observed in assistant records:** `tool_use`, `tool_result` *(yes, assistant lines can carry tool_result blocks — the census showed ~202 tool_use + ~201 tool_result in a sample)*, `thinking`, `text`.

### The dedup invariant (verified against real transcripts, 2026-07-09/10)

Claude Code writes **one JSONL line per content block** of a single API response. Every line repeats that response's usage snapshot. Consequences:

- For a given `message.id`: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (and the `cache_creation.{ephemeral_5m,ephemeral_1h}` sub-object) are **identical** across all its lines.
- `output_tokens` grows **monotonically** across the lines — the last line holds the max.
- **Naive per-line summation overcounts 2–4×** (proven on real transcripts). The fix: `group_by(.message.id) | map(.[-1])` — take the LAST record per id.

**Boundary-safe incremental passes:** a message's lines can span two tail passes. The sidecar stores `last_msg_id` + `last_msg_out` (output counted so far for that id); the next pass zeroes the in/cache contributions for records matching `last_msg_id` and counts only the output growth. The byte cursor only ever advances over newline-complete data (via a `_complete_bytes_end` helper) so a mid-write partial line is re-read whole on the next pass instead of being lost.

---

## 4. Usage object — full field census

The `message.usage` object on an assistant record (sampled shape):

```jsonc
{
  "input_tokens": 0,
  "output_tokens": 0,
  "cache_creation_input_tokens": 0,        // flat (older transcripts) OR mirrored with the sub-object
  "cache_read_input_tokens": 0,
  "cache_creation": {                       // tier split (newer transcripts)
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 0
  },
  "server_tool_use": {
    "web_search_requests": 0,
    "web_fetch_requests": 0
    // "code_execution_requests": N  — present only when code-exec tool used
  },
  "service_tier": null,                     // "standard" or null/absent
  "inference_geo": null,                    // "not_available", null, or "us"
  "iterations": null,
  "speed": null                             // "standard" or null/absent; "fast" possible
}
```

| Field | Billable? | Price source | Notes |
|---|---|---|---|
| `input_tokens` | yes | `models[$m].in` | base input |
| `output_tokens` | yes | `models[$m].out` | grows per-line within a message.id |
| `cache_read_input_tokens` | yes | `models[$m].cache_read` | 0.1× base input |
| `cache_creation.ephemeral_5m_input_tokens` | yes | `models[$m].cache_5m` | 1.25× base input; 5m cache write |
| `cache_creation.ephemeral_1h_input_tokens` | yes | `models[$m].cache_1h` | 2× base input; 1h cache write |
| `cache_creation_input_tokens` (flat) | yes | treated as `cc_5m` | **documented approximation** — older transcripts lack the sub-object; the whole value is treated as 5m-tier (Anthropic's historical default). Not a bug. |
| `server_tool_use.web_search_requests` | yes | `modifiers.web_search_per_1000` ($10/1k) | uniformly 0 across all 386 transcripts today |
| `server_tool_use.web_fetch_requests` | yes | `modifiers.web_fetch_per_1000` ($0) | uniformly 0; tracked for symmetry |
| `server_tool_use.code_execution_requests` | **no (out of scope)** | container-hours, not tokens | billed by execution time, not token usage |
| `service_tier` | no | — | `"standard"` or null/absent; never a billable tier in current data |
| `inference_geo` | modifier | `modifiers.inference_geo_us_multiplier` (1.1×) | `"not_available"`/null/absent = global (1.0×); `"us"` = 1.1×. Never `"us"` in current data. |
| `iterations` | no | — | not billable |
| `speed` | modifier | `models[$m].fast` prices | `"standard"`/null/absent = standard; `"fast"` = premium opus prices. Never `"fast"` in current data. |

**The 5 core token categories are already tracked 1:1** by the statusline scan (`in`/`out`/`cr`/`cc_5m`/`cc_1h`). Web-search/web-fetch capture is Track E5 (future-complete; 0 today).

---

## 5. Subagent transcripts — discovery & lifecycle

Subagent transcripts live at `~/.claude/projects/<proj>/<session-uuid>/subagents/agent-<id>.jsonl` and have the **same record shape** as main transcripts (same `usage` object, same dedup invariant — no special-casing needed).

### Discovery signal (in priority order)

A completed Task-tool subagent surfaces in the **main** transcript as a `type:"user"` `tool_result` record whose (recursively flattened) text contains BOTH:
1. `agentId: <id>` (a hex id), AND
2. a `<usage>...</usage>` block.

**Requiring BOTH is critical:** the earlier *launch-acknowledgement* record also mentions `agentId:` (text: `Async agent launched successfully.\nagentId: <id> ...`) but carries NO `<usage>` block. Matching on `agentId:` alone would double-count every subagent at launch time.

### Lifecycle states

| state | sidecar representation | when |
|---|---|---|
| **done** (resolved) | cumulative `subagent_*_total` + `subagent_models` + id in `counted_subagents` *(Track E3 schema)* | the subagent's own `agent-<id>.jsonl` is readable → scanned with the same dedup logic |
| **pending** (racing) | `pending_subagents[<id>] = {fallback_estimate, model}` *(Track E3)* | completion record seen but `agent-<id>.jsonl` not yet flushed/ readable |
| resolved-from-pending | folded into cumulative + removed from `pending_subagents` | retried on every subsequent render until the file appears |

**Nested subagents** write to the same `subagents/` dir as flat siblings — a flat glob (`subagents/agent-*.jsonl`) is complete at any spawn depth.

**Fallback estimate caveat:** the completion record's own `<usage>subagent_tokens: N</usage>` lump is the FINAL TURN's usage only, proven to undercount real usage 14–28×. It is kept only as a flagged `fallback_estimate` on a pending entry and **never folded into confirmed sums**. The real per-model breakdown from the subagent's own transcript always takes priority once readable.

### `--recompute-all` (full local rebuild)

Iterates every top-level main transcript under `~/.claude/projects/*/*.jsonl`, does a full-file dedup scan of the main thread + every `subagents/agent-*.jsonl` sibling (direct glob — more robust than completion-record parsing; a full local rescan can always read the files, so no pending entries remain), then rebuilds the sidecar's token fields wholesale. Duration-fold keys and cost-fold keys from an existing sidecar are **preserved** (via a jq `. +` merge); the byte cursor is set past the last complete line.

---

## 6. `<synthetic>` placeholders

A small number of records (59 across all transcripts) carry `"model": "<synthetic>"` with all-zero usage and non-`msg_` ids. These are **rate-limit-retry placeholders** injected by Claude Code when a request is retried after a rate-limit error.

**Parser rule:** exclude them from pricing AND from the dedup `group_by` (their ids aren't real message ids). The statusline scan filters them out explicitly: `select((.message.model // "") != "<synthetic>")`.

---

## 7. Cost data — definitively NOT in transcripts

Direct evidence (2026-07-10):
```
$ rg -i '"cost"|"total_cost"|"cost_usd"' <all 386 transcripts>   → (no output)
$ jq '... .message.usage | keys' <sample>                          → no cost-ish keys
```

`total_cost_usd` exists **only in the live hook payload** that Claude Code pipes to `statusline-command.sh` on each render (`payload.cost.total_cost_usd`). It is a single session-wide number, reset by Claude Code on session resume (the Track D1 cost-fold bug).

**Implication:** `--recompute-all` cannot synthesize cost — it only preserves prior sidecar cost keys. For sessions that never rendered live (or rendered with a zero/absent payload cost), the sidecar cost is 0/absent. **Track E4** fills these with an `estimated_cost_cents` computed from per-model token buckets × the pricing table (same method `SUB_COST` already uses). The estimate is the only available source; the display prefers the authoritative folded payload cost and falls back to the estimate when that is 0/absent.

---

## 8. Modes observed — uniformly default

Census across all 386 transcripts:

| field | `absent` | value seen | count |
|---|---|---|---|
| `inference_geo` | 20351 | `not_available` | 18227 |
| `speed` | 28146 | `standard` | 10432 |
| `service_tier` | 20351 | `standard` | 18227 |

**`"us"` geo, `"fast"` speed, and non-standard `service_tier` never appear.** The pricing page documents a `us` 1.1× multiplier (Opus 4.6/Sonnet 4.6+) and fast-mode premiums (Opus 4.8/4.7). These are **no-ops on current data** but forward-compatible: Track E2 pre-scans the session and applies the multiplier / fast prices at session level if ANY message carries the flag. Per-message exact bucketing is out of scope (2–4× the bucket count for zero current benefit).

---

## 9. Models observed → pricing-file keys

Exact `.message.model` strings seen across all transcripts, with their `claude-pricing.json` keys (Track E1):

| transcript model id | count | pricing-file key | in/out/cache_read $/MTok |
|---|---|---|---|
| `claude-sonnet-5` | 9071 (main) + 6152 (sub) | `claude-sonnet-5` | 2/10/0.20 *(intro; →3/15/0.30 after 2026-08-31)* |
| `claude-haiku-4-5-20251001` | 4888 + 4822 | `claude-haiku-4-5` | 1/5/0.10 |
| `claude-opus-4-8` | 2119 + 902 | `claude-opus-4-8` | 5/25/0.50 |
| `claude-sonnet-4-6` | 1396 + 630 | `claude-sonnet-4-6` | 3/15/0.30 |
| `claude-fable-5` | 753 + 100 | `claude-fable-5` | 10/50/1.0 |
| `<synthetic>` | 59 + 10 | *(excluded)* | — |

**All 5 real models have exact pricing entries.** The lookup order is: exact `models[$m]` → longest `families` prefix → `default`. Family average is used **only** when exact model costing is unavailable (e.g. a brand-new model id not yet in the file).

**Sonnet 5 cutover:** introductory $2/$10 through 2026-08-31, then $3/$15 from 2026-09-01. The pricing file carries `intro_until:"2026-08-31"` + an `.after:{...}` block; the lookup is date-aware.

---

## 10. Pricing reference

- **Data file:** `harnesses/claude-code/config/claude-pricing.json` (shipped) + `~/.claude/claude-pricing.json` (global copy, written at install).
- **Source URL:** `https://platform.claude.com/docs/en/about-claude/pricing` (fetched 2026-07-10).
- **Schema:** per-MTok USD. `models[<id>]={in,out,cache_5m,cache_1h,cache_read}`; Opus 4.8/4.7 add `.fast={in,out}`; Sonnet 5 adds `intro_until` + `.after`. `families[<prefix>]` for fallback. `default` last-resort. `modifiers={inference_geo_us_multiplier:1.1, web_search_per_1000:10.0, web_fetch_per_1000:0.0}`.
- **Stacking:** multipliers STACK — cache tier × inference_geo(us) × fast. (e.g. a 1h cache write on opus-4-8 with `us` geo = `cache_1h` × 1.1.)
- **Lookup order (script):** `CLAUDE_PRICING_FILE` env → `~/.claude/claude-pricing.json` → shipped `config/claude-pricing.json` → hardcoded in-script table (fail-open).
- **Refresh policy:** ship + manual refresh via product releases. An auto-refresh command (re-fetch the pricing page) is future work.
- **Out of scope for the cost script:** Batch API 50% discount (interactive sessions, not batch), Managed Agents session-runtime billing ($0.08/session-hour), code-execution container-hours, cloud-platform (Bedrock/Vertex) pricing, tool-use system-prompt token overhead (not in `usage`).

---

## 11. Parser implications (checklist for future features)

1. **Filter to `.type == "assistant"`** for usage extraction. Everything else is metadata.
2. **Dedup by `message.id`, last-per-id wins** (`group_by(.message.id) | map(.[-1])`). Naive per-line summation overcounts 2–4×.
3. **Exclude `<synthetic>` model** records — all-zero usage, non-real ids, would corrupt both dedup and pricing.
4. **Boundary-safe incremental cursor:** only advance over newline-complete lines (`_complete_bytes_end`); carry `last_msg_id`/`last_msg_out` across passes so a message split mid-scan contributes its in/cache once and only the output growth on the second pass.
5. **Subagent discovery requires BOTH `agentId:` AND `<usage>`** in a `type:"user"` `tool_result`'s flattened text — launch-ack records mention `agentId:` alone and must not count.
6. **Pending subagents are retried every render** until their `agent-<id>.jsonl` is readable; their `fallback_estimate` (the completion record's `subagent_tokens` lump) is a 14–28× undercount and must never be folded into confirmed sums.
7. **Cost is payload-only** — never read cost from transcripts; it isn't there. Use the pricing-table estimate for recompute-only sessions.
8. **Fail-open discipline:** any jq/parse failure must leave state untouched and the script still render (exit 0). The statusline runs on every Claude Code tick; it must never crash.
9. **Idempotency:** re-running a scan on unchanged data must add nothing (guarded by `last_msg_id`/`transcript_offset` + `counted_subagents`/`findActiveArtifactBySignature`-style guards).
10. **Tiered cache:** prefer `cache_creation.ephemeral_{5m,1h}_input_tokens` when the sub-object exists; fall back to flat `cache_creation_input_tokens` treated as 5m-tier (documented approximation).
11. **Modes are session-level:** geo `us` / speed `fast` are uniformly default today; handle at session granularity (pre-scan, apply multiplier/prices if ANY message carries the flag), not per-message bucketing.
