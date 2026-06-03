---
name: html-preview
description: Use when deciding whether to output HTML or markdown, generating design options or specs a human will judge visually, creating interactive prototypes with toggles, or producing reports 100+ lines that require navigation.
---

# HTML Preview

Output HTML when a human will read and judge the result visually. Use markdown for everything else.

## Decision Rule

**Use HTML when:**
- Design options requiring visual side-by-side comparison
- Specs, reports, or decision artifacts 100+ lines a human must navigate
- Interactive prototypes with live toggles (layout variants, font/color presets)
- Anything with diagrams, color-coding, or visual hierarchy that communicates meaning
- The human will *judge quality*, not just read information

**Use markdown when:**
- Agent-to-agent context or handoffs
- Short answers and direct responses
- Logic/text decisions without visual complexity
- Content not meant to be read as a document

**Never use HTML for** simple outputs, inline answers, or anything where markdown is sufficient. HTML costs 2-3x more tokens — only reach for it when visual format reduces back-and-forth cycles. Ask: "Will the human judge this visually or just read text?" If text: markdown.

## Local Serving

```bash
python3 -m http.server 8080 --directory <dir>
# Open http://localhost:8080
```

Each HTML file must be self-contained (inline CSS + JS). Never reuse filenames — each iteration gets a new file (`topic-v1.html`, `topic-v2.html`). The `/brainstorming` skill's visual-companion handles this workflow automatically for design sessions.

## Key Patterns That Earn HTML's Cost

- **Toggle variants**: multiple options switchable from one file — user decides visually without re-prompting
- **Color-coded reports**: severity levels, domain tags, status indicators
- **Side-by-side comparisons**: old vs new, option A vs B
- **Navigable specs**: anchor links, collapsible sections, search

## Authoring patterns

- **Two-way export**: when the artifact has interactive controls (toggles, edits, selections), include a button that serializes the user's choices back to copyable JSON/text — so their decisions can be pasted straight into a re-prompt. Closes the loop without screenshots.
- **`file://` vs server**: open the file directly (`file://`) for a static self-contained report. Reach for `python3 -m http.server` only when the page needs relative asset paths or fetch-based interactivity.
- **Anti-patterns (do NOT use HTML for)**: answers under ~100 lines, agent-to-agent context/handoffs, or any output the consumer reads as text rather than renders visually. HTML there just burns tokens.

## What the Article Says

> "I tend to not actually read more than a 100-line Markdown file... But HTML documents are much easier to read."

> "The real reason I use HTML instead of Markdown is that it helps me feel much more in the loop with Claude."

Source: [The Unreasonable Effectiveness of HTML](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html)
