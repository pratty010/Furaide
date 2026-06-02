# OpenAI GPT-5.x Prompting Nuance

Active when model family is `openai/*` (gpt-5.2, 5.3-codex, 5.4, 5.4-mini, 5.5).

---

## Instruction style

- **Imperative over conversational.** Write "Return a JSON array." not "Could you return a JSON array?"
- Embed role in the first sentence of the system prompt. GPT-5.x instruction-follows better when role context precedes task context.
- Avoid contradictory directives in the same message — GPT-5.x will attempt to satisfy both and produce inconsistent output. Audit for conflicts before sending.

## Reasoning effort

`reasoning_effort` parameter controls cost/quality tradeoff:
- `high` — novel problems, architecture decisions, adversarial review, legal/compliance. Default for `reviewer`, `legal-compliance`, `synthesizer`.
- `medium` — multi-file codegen, research synthesis, moderate debugging. Default for `coding`, `debugger`, `brand-builder`.
- `minimal` — scan/parse/extract, boilerplate, format transforms. Use for `extractor`/`formatter` fallback when on gpt-5.x. Pair with tool preambles (see below).

## Tool preambles for low-effort runs

When `reasoning_effort: minimal`, prepend a one-line tool preamble before each tool call:
> "Next: call `<tool_name>` to <verb> <object>."

This compensates for reduced lookahead and prevents tool-selection errors.

## Verbosity control

`verbosity` parameter (where supported): `concise` for subagent outputs that feed into further processing; `detailed` for final user-facing outputs. Omit for default behavior.

## Long-session formatting decay

In sessions >10 turns, GPT-5.x may drop markdown formatting and code fence discipline. Re-append formatting rules every 3-5 turns as a brief reminder:
> "Reminder: use markdown headers, fenced code blocks with language tags, and no inline HTML."

## gpt-5.3-codex specifics

- Requires `phase` field in multi-file edit requests: `phase: "read"` before edits, `phase: "write"` for the edit batch.
- Computer-use compatible — the `computer_use` tool is available; invoke it for tasks requiring cursor/scroll/screenshot.
- Cheapest GPT-5.x option for codegen; prefer over 5.4 unless reasoning is the bottleneck.

## Escape hatches for stuck states

- Model repeating same tool call: inject "Previous attempt failed. Try a different approach: [constraint]."
- Model over-explaining instead of acting: inject "Skip preamble. Execute directly."
- Model asking clarifying questions mid-task: inject "Make a reasonable assumption and proceed. State it in one line."

---

## Your three most-likely failure modes

1. **Instruction conflict** — two directives contradict; you average them instead of flagging. Audit prompts before sending.
2. **Reasoning-effort mismatch** — high-complexity task sent at `minimal` effort; output is shallow and misses edge cases. Check `reasoning_effort` before delegating.
3. **Formatting decay in long sessions** — markdown discipline degrades after turn 10+; re-append formatting rules proactively.
