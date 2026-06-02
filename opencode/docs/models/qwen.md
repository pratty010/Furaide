# Qwen 3.x Prompting Nuance

Active when model family is `opencode-go/qwen3.6-plus`, `opencode-go/qwen3.7-max`.

---

## Thinking: enabled by default

- **Thinking is ON by default.** Control it via soft-switches in the last user message:
  - `/think` — force thinking enabled.
  - `/no_think` — disable thinking.
  - **Most recent prefix wins** if multiple are present.
- Alternatively, set `enable_thinking: true|false` in `chat_template_kwargs` (hard override).
- When thinking is enabled, output includes internal `<think>` blocks.

## CRITICAL: History rule for thinking

**STRIP `<think>…</think>` blocks from history before the next turn.** This is the opposite of MiniMax.

- Include the model's response (text, tool calls, reasoning conclusion) in history.
- Remove the `<think>` blocks before sending the next request.
- Consequence of NOT stripping: bloated context, next-turn reasoning becomes confused and hallucinated.

> **Cross-family contrast:** MiniMax M2.x requires KEEP (the opposite rule). GLM-5.x also strips. If you are routing multiple model families, double-check which rule applies — getting this wrong silently degrades multi-turn performance. See `docs/models/minimax.md`.

## Sampling parameters

### With thinking enabled

- `temperature: 0.6`
- `top_p: 0.95`
- `top_k: 20`
- `repetition_penalty: 1.05` (for function-calling examples to reduce loops)

### Without thinking

- `temperature: 0.7`
- `top_p: 0.8`
- `repetition_penalty: 1.05` (still applied)

### Never use

- **`temperature: 0` (greedy decode) causes infinite loops.** Always use sampling.

## Tool template

- **Use Hermes-style tool templates.** AVOID ReAct or stopword-based templates — stopwords emitted mid-reasoning break tool parsing and corrupt the response.
- Canonical implementation: `Qwen-Agent` (also supports MCP).
- vLLM flags: `--tool-call-parser hermes --reasoning-parser deepseek_r1`.

## Soft-switch scope

`/think` and `/no_think` work **only in user messages** (the last user message wins). Placing them in the system prompt has no effect — the model silently ignores them. Always put soft-switches at the end of the user turn, not the system prompt.

**ReAct-only environments:** If your deployment framework only supports ReAct-style templates (e.g., legacy LangChain), Qwen 3.x cannot be used safely for tool-calling tasks in that environment. Fallback to a model that supports Hermes-style parsing, or upgrade the template.

## Context and deployment

- **qwen3.6-plus:** 1M context at the cheapest price point. Ideal for legal/PM-spec/explorer roles (high volume, moderate reasoning).
- **qwen3.7-max:** API-only; some open-doc parameters may differ from local deployment. Use for production; verify params in the API response metadata.

---

## Your three most-likely failure modes

1. **Not stripping `<think>` from history** — if you leave thinking blocks in the next turn's input, context bloats, and next-turn reasoning becomes confused. Always sanitize history before the next request.
2. **Using ReAct or stopword templates** — if you use ReAct-style tool parsing (e.g., stopwords like "STOP" or "DONE"), those words emitted mid-reasoning break tool invocation. Use Hermes-style parsing only.
3. **Greedy decode (temperature: 0)** — setting `temperature: 0` causes infinite loops in tool-calling scenarios. Always use non-zero temperature; 0.6–0.7 is safe.
