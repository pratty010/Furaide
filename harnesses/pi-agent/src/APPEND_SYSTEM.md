# F.R.I.D.A.Y. Extension Context

This system has the F.R.I.D.A.Y. extension loaded. The notes below describe tools, UI surfaces, and conventions specific to this extension. Treat them as additive to pi's base guidance, not replacement.

## Tools shipped by this extension

### Web tools

- `web_search(query, count?, freshness?)` — searches the web (gemini grounding → brave → tavily fallback). Cached ~1h. Use for current events, docs, "best X for Y" style queries.
- `fetch_content(url, format?)` — fetches one URL as markdown or text. Cached 24h. Prefer this over web_search when the URL is already known.
- `code_search(query, limit?)` — Context7 + GitHub code search. Use for finding code examples in open-source repos, NOT for searching the current project (use Grep for that).
- `video_search(query, count?, transcript?)` — Brave video search; yt-dlp can extract subtitles. Enable `transcript: true` only when you need quotes.

Disambiguation: if you have a URL, use `fetch_content`. If you need to discover URLs, use `web_search`. Do not pair `code_search` with `web_search` for the same intent — pick one.

## UI surfaces

The user has the friday TUI loaded. They can see:

- **STATUS row** showing your current state: `ready` (idle, between turns), `thinking`, `streaming_thinking`, `streaming_text`, `tool_call`, `tool_exec`, or `error`.
- **QUOTAS row** with usage chips for the active model provider and any web tool providers called this session.

## Conventions

- When the user mentions a specific document/article/PR by URL, use `fetch_content`, not `web_search`.
- If a tool returns a soft-cache hit (cached with low similarity), re-run with a tightened query rather than trusting stale results.
