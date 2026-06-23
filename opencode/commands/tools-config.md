---
description: Configure Web Tools defaults, provider order, usage warnings, and resets.
argument-hint: "[web-search|fetch-content|maps-search] [show|reset|show-usage|suppress-warning|reset-usage]"
agent: tanuki--general-trickster
---

Read `web-tools.yml` from the active OpenCode config root (e.g. `~/.config/opencode/`).

If `$ARGUMENTS` contains a subcommand, handle it and skip the editing flow:
- **show-usage**: Read usage budgets from `web-tools.yml` and display how many calls remain per tool/provider.
- **suppress-warning <provider>**: Set the warning-suppressed flag for the given provider.
- **reset-usage <provider|all>**: Reset usage counters for the given provider or for all providers.

Otherwise, walk the user through the editing flow:

1. **Pick a tool.** Ask: "Which tool do you want to edit? web-search, fetch-content, maps-search, or all?" Wait for their answer.
2. **Show basic fields.** Read `web-tools.yml` and display the current basic fields for the chosen tool(s):
   - **web-search**: defaultProvider, primaryFallbackOrder, count, freshness, rawContent
   - **fetch-content**: defaultProvider, format
   - **maps-search**: defaultProvider, count
3. **Edit each field.** For each basic field of the chosen tool(s), ask if they want to change it. If yes, show the current value, ask for the new value, then confirm the change ("Set defaultProvider to tavily? y/n").
4. **Advanced options.** After all basic changes, ask: "Open Advanced provider-specific options? (yes / open in editor)"
   - **yes**: Step through each advanced field for the chosen tool(s):
     - web_search advanced: depth, answer, minScore, includeDomains, excludeDomains, country, topic, includeImages, highlights, braveGoggles
     - fetch_content advanced: depth, maxChars, maxDepth, limit, selectPaths, query, chunksPerSource
     - maps_search: no advanced options (skip)
   - **open in editor**: Open `$EDITOR` pointing at the YAML path. After the editor exits, re-read the file and validate the YAML. If valid, show a summary of what changed; if invalid, report the error and ask if they want to try again.
5. **Write.** Show a summary of all pending changes. Ask: "Write these changes to web-tools.yml? (y/n)". Only write the YAML file after explicit confirmation.
