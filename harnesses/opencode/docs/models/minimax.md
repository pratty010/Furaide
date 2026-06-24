# MiniMax M2.x Prompting Nuance

Active when model family is `opencode-go/minimax-m2.5`, `opencode-go/minimax-m2.7`.

---

## Interleaved thinking

- **MiniMax emits `<think>…</think>` blocks between every tool call.** This is internal reasoning, not a tag you define in your prompt.
- Do NOT use `<think>` as a structural delimiter in your system or user prompts — it will collide with the model's internal reasoning markers and break parsing.

## CRITICAL: History rule for multi-turn reasoning

**KEEP the FULL assistant response (thinking + text + tool_use) in history every turn.** Stripping the `<think>` block breaks the reasoning chain on the next turn.

### Implementation by SDK

- **Anthropic SDK:** Append the full `response.content` list unchanged to conversation history.
- **OpenAI SDK with `reasoning_split=True`:** Preserve `reasoning_details` in history alongside the `content` field.
- **OpenAI SDK with `reasoning_split=False`:** NEVER modify or strip the `<think>` block inside the `content` string. Return it verbatim.

**Consequence of stripping:** The next turn has no context for the model's previous reasoning. It will repeat work, contradict itself, or fail tool disambiguation.

> **Cross-family contrast:** Qwen 3.x uses the OPPOSITE rule — it STRIPS `<think>` from history. GLM-5.x also strips its `<thinking>` blocks. MiniMax is the only family that requires KEEP. See `docs/models/qwen.md` and `docs/models/glm.md`.

## Endpoints

- **OpenAI-compatible endpoint** — use OpenAI SDK as-is.
- **Anthropic-compatible endpoint** — use Anthropic SDK as-is.
- Both are available; choose based on your client library preference and existing patterns.

## Temperature and sampling

- **Not explicitly documented in the model card.** Use the model's default (do not override) unless you have a specific reason.
- Omit `temperature`, `top_p`, `top_k` parameters unless experimenting.

## Stripping thinking on parent handoff

- When a MiniMax child agent returns output to a parent agent, **use `sanitizeForParent()` from `scripts/lib/history-serializer.mjs`** to strip the `<think>` blocks from the RETURNED payload.
- **The child's own internal history still keeps them** — only the payload handed up is sanitized.
- This prevents the parent from receiving and re-processing the child's internal reasoning.

**Fallback if `history-serializer.mjs` is unavailable:** Manually strip any content matching `<think>[\s\S]*?</think>` from the returned payload before passing to the parent. Never strip from the child's own history array.

## Escape hatches for stuck states

- **Reasoning loop (thinking block grows infinitely):** Inject "Stop internal deliberation. Emit your current best answer now, even if incomplete."
- **Repeated tool call:** Inject "The previous tool call produced no new result. Try a different tool or a different argument."
- **Contradicting a previous turn:** Inject "Your last response contradicted your earlier finding. State which answer is correct and why."

## Version notes

- **m2.7** — current workhorse; preferred for new work.
- **m2.5** — predecessor fallback. Use only if m2.7 is unavailable.

---

## Your three most-likely failure modes

1. **Stripping `<think>` from history breaks multi-turn reasoning** — if you remove the thinking blocks from the conversation history before sending the next turn, the model has lost its context. Always preserve the full response including `<think>`.
2. **Using `<think>` as a structural delimiter in your prompt** — if you write `<think>analyze this</think>` in your system prompt, it collides with the model's internal reasoning tag and breaks tokenization. Use different markers (e.g., `[REASONING]…[/REASONING]`) or plain prose instead.
3. **Not reading `reasoning_details` on OpenAI SDK with `reasoning_split=True`** — if you ignore the `reasoning_details` field, you lose the reasoning signal that explains the next action. Always extract and log it for debugging multi-step workflows.
