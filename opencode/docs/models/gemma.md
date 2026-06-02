# Gemma 4 Prompting Nuance

Active when model family is `google/gemma-*` (gemma-4-26b-a4b-it, gemma-4-31b-it).

Gemma 4 is a local model — no API cost. Use when offline safety matters or when opencode-free quota is exhausted. Fallback role only in current routing (data-analyst local fallback / free-quota exhausted fallback).

---

## Control token format — required

Gemma 4 requires strict control-token formatting. Deviating from this format causes instruction loss or silent failure.

```
<start_of_turn>user
<your message here>
<end_of_turn>
<start_of_turn>model
```

- `<start_of_turn>user` opens each user turn.
- `<end_of_turn>` closes it.
- `<start_of_turn>model` opens the model response slot; do not put content here in the prompt — the model fills it.
- For multi-turn: alternate `user`/`model` blocks.

## No separate system role

**Gemma 4 does not have a separate system role.** Embed all behavioral instructions (role, constraints, output format) inside the first `<start_of_turn>user` message.

```
<start_of_turn>user
You are a data analyst. Return results as CSV only. Do not explain.

Analyze the following dataset: [...]
<end_of_turn>
<start_of_turn>model
```

Do NOT use a `system:` prefix or separate system block — it will be ignored or cause format errors.

## No thinking_level parameter

Gemma 4 does not support `thinking_level` or `reasoning_effort` parameters. There is no explicit reasoning-mode toggle. For tasks requiring more careful reasoning, increase prompt detail and add step-by-step instructions in natural language.

## JSON schema in natural language

Gemma 4 does not support the `responseSchema` API parameter. Describe JSON structure in natural language inside the prompt.

```
Return a JSON object with these fields:
- "filename": string
- "line_count": integer
- "has_errors": boolean
Return only the JSON object, no prose.
```

Validate output structurally before passing to downstream tools — Gemma 4 may include trailing text.

## Prompt length

- gemma-4-26b-a4b-it: suitable for short-to-medium tasks (recommend ≤8K tokens).
- gemma-4-31b-it: handles longer context; use as the default Gemma variant when context matters.

## Determinism

Gemma 4 responds well to explicit temperature overrides. For deterministic scan/parse tasks, `temperature: 0.0` is appropriate (unlike Gemini 3.x). For creative or synthesis tasks, use `temperature: 0.7–0.9`.

---

## Your three most-likely failure modes

1. **Missing control tokens** — prompt sent without `<start_of_turn>`/`<end_of_turn>` format; model generates incoherent output or echoes the prompt. Always use the exact token format.
2. **System role in separate block** — behavioral instructions placed outside the first user turn; Gemma ignores them entirely. Embed everything in the first user message.
3. **Schema via API parameter** — `responseSchema` passed as an API field; Gemma silently ignores it. Describe structure in natural language instead.
