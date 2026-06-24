# Gemini 3.x Prompting Nuance

Active when model family is `google-vertex/gemini-*`.

**Routing reminder:** Gemini 2.x family (`gemini-2.5-*`) is out of auto-routing — whitelisted for manual selection only; never auto-route. Active Gemini models are:
- **Workhorse:** `gemini-3-flash-preview`, `gemini-3.1-flash-lite`
- **Reserve:** `gemini-3.1-pro-preview`, `gemini-3.1-pro-preview-customtools`, `gemini-3.5-flash`

---

## Delimiters — required

XML and markdown delimiters are **required** for Gemini 3.x to maintain section boundaries across a long context. Without them, Gemini merges sections and loses instruction precedence.

```
<task>...</task>
<context>...</context>
<output_format>...</output_format>
```

Always wrap structural distinctions in XML tags, not just markdown headers.

## Context before queries

Put background context before the question/task. Gemini 3.x attends more reliably to early context than late context. Structure: `<context>` → `<task>` → `<output_format>`.

## Few-shot examples

Few-shot examples are essential for Gemini 3.x on structured output and style-sensitive tasks. Provide ≥2 input/output pairs inside `<examples>` tags before the actual task.

## Thinking level

`thinkingLevel` parameter: `minimal` | `low` | `medium` | `high`
- `minimal` — fast, scan-level tasks (`@scanner`)
- `low` — routine codegen fallbacks
- `medium` — research, synthesis, multi-step reasoning
- `high` — architectural decisions, paper analysis (`@academic`), reserve-tier tasks

## Temperature — critical for Gemini 3.x

**Temperature MUST stay at `1.0` for all Gemini 3.x models.** Lowering temperature below 1.0 causes loop/degradation behavior specific to Gemini 3's training. Do not override to 0.0 for "determinism" — use `thinkingLevel: minimal` instead if you need reduced variance.

Exception: this constraint applies to Gemini 3.x only. Gemini 2.x (which is out-of-routing) had different behavior.

## Structured output

Use `responseSchema` for structured output rather than asking for JSON in prose. Deeply nested JSON schemas cause degradation — flatten to ≤3 levels. If your schema is deeper, break into multiple sequential calls.

```json
// Prefer flat:
{ "title": "string", "tags": ["string"], "confidence": "number" }

// Avoid deeply nested:
{ "result": { "meta": { "analysis": { "confidence": "number" } } } }
```

## System role placement

Gemini 3.x works correctly with system instructions in any position. No special placement rule needed (unlike some other families).

---

## Your three most-likely failure modes

1. **Temperature override** — someone sets `temperature: 0.0` for "consistency"; Gemini 3.x enters looping/degradation mode. Always enforce `temperature: 1.0`.
2. **Missing delimiters** — long-context prompt without XML tags causes instruction bleed between sections; model merges task and context.
3. **Overly nested schema** — `responseSchema` with >3 nesting levels causes malformed output or refusal; flatten first.
