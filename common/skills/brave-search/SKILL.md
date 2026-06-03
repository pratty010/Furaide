---
name: brave-search
description: |
  Use for Brave-powered web or news search when the user wants ranked search results, current articles, latest information, domain-filtered results, freshness/date-range filtering, Goggles, pagination, locale-aware search, or Tavily-style JSON output. Use this skill whenever the task is to return search/news results, not a synthesized answer. Run the bundled wrapper script, not `bx` directly, so cleanup and token reduction happen before results enter the model context.
allowed-tools: Bash(python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py *)
---

# brave-search

Run the bundled wrapper script. It calls `bx web` or `bx news`, strips Brave-only bulk fields, trims snippets, and returns Tavily-style JSON before the model sees the payload.

## Core rules

- Never call `bx` directly from the model when this skill is active.
- Always use `python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py ...`.
- The wrapper may call only `bx web` or `bx news`.
- Default to 10 results and structured indented JSON output:

```json
{
  "query": "user query",
  "results": [
    {
      "url": "https://example.com",
      "title": "Example title",
      "content": "Short useful snippet",
      "published_date": "2026-04-14T10:00:00",
      "score": 0.82
    }
  ]
}
```

- Omit empty fields and Brave-only sections unless the user explicitly asks for raw output with `--output raw`.

## When to use

- General web search with ranked links and snippets
- Explicit news/article search
- "latest", "current", "today", "recent", "breaking", or date-range lookups
- Domain include/exclude filtering
- Search-operator-heavy queries
- Goggles-based reranking
- Pagination or locale-specific search
- Location-aware Brave web search

## When not to use

- The user wants extracted page content for RAG or grounding instead of ranked result lists
- The user wants a synthesized AI answer instead of search results
- The user needs image, video, places, or answers-specific behavior
- This skill returns ranked result lists from bx web/news only — not extracted page content or synthesized answers

## Runtime entrypoint

Use:

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py "<query>"
```

The wrapper chooses `news` only for explicit news-like queries when `--source auto` is used. Prefer setting `--source news` or `--source web` explicitly when intent is clear.

## Output shape

By default the wrapper returns indented Tavily-style JSON with:
- top-level keys: `query`, `results`
- result keys: `url`, `title`, `content`, `published_date`, `score`

Results are sorted by score descending. The `score` field (0–1) is computed locally as a blend of query-term overlap and rank prior. The script trims noisy markup, deduplicates snippets, removes empty fields, and caps content length per result.

## Option map

Pass these options to `brave_search.py`. The script forwards them to `bx` and handles normalization locally.

### Core wrapper flags

| Flag | Purpose |
|---|---|
| `--source <auto|web|news>` | Command family selection |
| `--count <N>` | Result count. Default `10` |
| `--max-results <N>` | Alias for `--count` |
| `--max-content-chars <N>` | Per-result snippet cap. Default `220` |
| `--min-score <FLOAT>` | Drop results below this score. Default `0` |
| `--top <N>` | Keep only top N results after scoring |
| `--output <normalized|raw>` | Tavily JSON or raw Brave JSON |
| `--pretty` | Pretty-print indented JSON (default) |
| `--compact` | Emit minified JSON |
| `--save-raw <PATH>` | Save the raw Brave payload to disk for inspection |

### Shared Brave flags

| Flag | Purpose |
|---|---|
| `--config <PATH>` | Use a non-default `bx` config file |
| `--api-key <KEY>` | Override API key for the call |
| `--base-url <URL>` | Override Brave API base URL |
| `--timeout <SECONDS>` | Request timeout |
| `--extra <KEY=VALUE>` | Pass raw Brave API params not surfaced as first-class flags |
| `--endpoint <PATH>` | Override Brave endpoint path |
| `--country <CODE>` | Country hint such as `US`, `GB`, `DE` |
| `--search-lang <LANG>` | Search language such as `en`, `fr` |
| `--ui-lang <LOCALE>` | UI locale such as `en-US` |
| `--offset <N>` | Pagination offset |
| `--safesearch <off|moderate|strict>` | SafeSearch policy |
| `--freshness <pd|pw|pm|py|YYYY-MM-DDtoYYYY-MM-DD>` | Relative or explicit date filter |
| `--spellcheck <true|false>` | Spellcheck control |
| `--extra-snippets <true|false>` | Ask for additional snippets. Default `false` |
| `--goggles <RULES>` | Inline, file, stdin, or hosted Brave Goggles. Repeatable |
| `--include-site <DOMAIN>` | Allowlist domains, comma-separated or repeatable |
| `--exclude-site <DOMAIN>` | Blocklist domains, comma-separated or repeatable |
| `--operators <true|false>` | Enable or disable Brave search operators |

### Web-only flags

| Flag | Purpose |
|---|---|
| `--text-decorations <true|false>` | Toggle `<strong>`-style highlighting. Default `false` |
| `--result-filter <csv>` | Filter result types such as `web`, `news`, `discussions`, `faq`, `infobox`, `videos`, `locations`. Default `web` |
| `--units <metric|imperial>` | Measurement units |

### Location-aware web flags

| Flag | Purpose |
|---|---|
| `--lat <FLOAT>` | Latitude |
| `--long <FLOAT>` | Longitude |
| `--timezone <IANA>` | Timezone such as `America/New_York` |
| `--city <NAME>` | City |
| `--state <CODE>` | State abbreviation |
| `--state-name <NAME>` | Full state name |
| `--loc-country <CODE>` | Country code for location header |
| `--postal-code <CODE>` | Postal code |

## Query craft

- Think search query, not prompt. Phrase as a few keywords, not a conversational sentence.
- Keep queries short (typically 2–5 keywords). Complex asks should be broken into multiple sub-queries.
- Use `--result-filter discussions` for troubleshooting and community-sourced answers (Stack Overflow, GitHub issues, forums).
- Results are globally sourced by default (no region bias). Override region with `--country`, search language with `--search-lang`, or UI language with `--ui-lang`.

## What tends to work best

- Official docs or trusted sources:
  - use `--source web` plus repeat `--include-site`
- Breaking or article-focused queries:
  - use `--source news` plus `--freshness pd|pw|pm`
- Noisy general web queries:
  - use `--exclude-site`
- Troubleshooting and community answers:
  - use `--source web --result-filter discussions`
- Brave-specific reranking:
  - use `--goggles`
- Keep `--extra-snippets false` unless extra context is clearly worth the added payload size

## Examples

### Official docs only

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "rust async" \
  --source web \
  --include-site rust-lang.github.io
```

### Recent news

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "AI news" \
  --source news \
  --freshness pd
```

### Historical news window

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "climate summit" \
  --source news \
  --freshness 2026-04-01to2026-04-14
```

### Exclude a noisy source

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "python dependency injection tutorial" \
  --source web \
  --exclude-site medium.com
```

### Discussion-heavy search

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "python TypeError cannot unpack non-iterable NoneType" \
  --source web \
  --result-filter discussions
```

### Goggles reranking

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "python dependency injection" \
  --source web \
  --goggles '$boost=5,site=docs.python.org
$downrank=3,site=medium.com'
```

### Location-aware web search

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "coffee shops open now" \
  --source web \
  --lat 37.7749 \
  --long -122.4194 \
  --timezone America/Los_Angeles
```

### Raw Brave output

```bash
python3 /home/ace/.agents/skills/brave-search/scripts/brave_search.py \
  "shrinking" \
  --source web \
  --output raw \
  --pretty
```
