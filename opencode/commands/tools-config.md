---
description: Configure Web Tools defaults, provider order, usage warnings, and resets.
argument-hint: "[TOOL: web-search|fetch-content|maps-search|all] [ACTION: show|reset|show-usage|suppress-warning|reset-usage]"
---

Locate `web-tools.yml` by checking these paths in order; use the first that exists:

1. `./.opencode/web-tools.yml` (project-level)
2. `~/.config/opencode/web-tools.yml` (global)

If neither exists, ask the user whether to create one at `./.opencode/web-tools.yml` with default settings, then proceed with that path. Remember the resolved path — write back to it in step 5.

## Arguments

- `$TOOL` — one of: `web-search`, `fetch-content`, `maps-search`, `all`. If empty or invalid, present this numbered list and wait for the user to pick:
  1. web-search
  2. fetch-content
  3. maps-search
  4. all
- `$ACTION` — one of: `show`, `reset`, `show-usage`, `suppress-warning`, `reset-usage`. If empty or invalid, present this numbered list and wait for the user to pick:
  1. show — display current config
  2. reset — reset to defaults
  3. show-usage — display remaining budgets
  4. suppress-warning — silence budget warnings
  5. reset-usage — reset usage counters

If `$ACTION` is `suppress-warning` or `reset-usage`, also ask for the provider name (`gemini`, `brave`, `tavily`, or `all`).

## Subcommand behavior

If `$ACTION` is set to a non-editing subcommand:

- **show-usage**: Read usage budgets and display remaining calls per tool/provider.
- **suppress-warning**: Set the warning-suppressed flag for the given provider.
- **reset-usage**: Reset usage counters for the given provider or all.
- **show**: Display current config for `$TOOL`.
- **reset**: Reset `$TOOL` to defaults and write back.

If `$ACTION` is empty, walk the editing flow:

1. **Pick a tool.** Use `$TOOL` if set and valid; otherwise use the numbered list above.
2. **Show basic fields.** Read `web-tools.yml` and display current basic fields for the chosen tool(s):
   - **web-search**: defaultProvider, primaryFallbackOrder, count, freshness, rawContent
   - **fetch-content**: defaultProvider, format
   - **maps-search**: defaultProvider, count
3. **Edit each field.** For each basic field, ask if they want to change it. If yes, show current value, ask for new value, confirm.
4. **Advanced options.** Ask: "Open Advanced provider-specific options? (yes / open in editor)"
   - **yes**: Step through each advanced field for the chosen tool(s):
     - web_search advanced: depth, answer, minScore, includeDomains, excludeDomains, country, topic, includeImages, highlights, braveGoggles
     - fetch_content advanced: depth, maxChars, maxDepth, limit, selectPaths, query, chunksPerSource
     - maps_search: no advanced options (skip)
   - **open in editor**: Open `$EDITOR` at the resolved YAML path. After exit, re-read and validate. If valid, show what changed; if invalid, report and ask to retry.
5. **Write.** Show a summary of pending changes. Ask: "Write these changes to web-tools.yml? (y/n)". Write to the same path resolved at the start.
