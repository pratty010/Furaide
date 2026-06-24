# GLM-5.x Prompting Nuance

Active when model family is `opencode-go/glm-5`, `opencode-go/glm-5.1`.

---

## System role and messages

- **OpenAI-style `system` role fully supported.** Structure: `system` message first, followed by `user`/`assistant` turns.
- Embed role in the system prompt as you would for GPT-5.x — GLM-5 instruction-follows better with role context upfront.

## Thinking toggle

- **Thinking is toggled via top-level field `thinking: {type: "enabled"|"disabled"}` — NOT a message.**
- Default: disabled. Enable only when the task requires deep multi-step reasoning (architecture decisions, adversarial review, novel problem-solving).
- **Disable thinking when latency-bound** — it adds ~2 seconds per turn. For agentic workflows scanning multiple files or extracting data, keep it off.
- When enabled, output includes an internal `<thinking>` block (visible in the response); the model's reasoning counts toward context.

## History rule for thinking blocks

When `thinking: {type: "enabled"}`, the model emits a `<thinking>…</thinking>` block in the response.

**STRIP `<thinking>` blocks from history before the next turn.** Do not include them in the messages array on the next request.

- Unlike MiniMax (which requires KEEP), GLM's thinking blocks are internal scratch-pad — they degrade next-turn performance if fed back.
- Include only the final `content` (the visible answer) in history.

## Temperature

- **Agentic/coding work: `temperature: 0.6`** for determinism; tool orchestration must be reproducible.
- **Creative writing: `temperature: 1.0`** — especially glm-5.1 on the writer specialist. Accept variance.
- Avoid `temperature: 0` (greedy decode can produce loops).

## Function-calling

- **OpenAI-compatible schema.** Define tools as you would for GPT; GLM-5 parses and executes identically.
- If the model repeats the same tool call twice, inject: **"Previous attempt failed. State a new plan in one sentence, then proceed."**

## Context

- **Input: 200K tokens.** Output: 128K tokens. Plan syntheses and long document generation accordingly — chunk at 100K output to avoid surprises.

---

## Your three most-likely failure modes

1. **Thinking enabled on high-volume scans** — scanning 50+ files with thinking:enabled becomes expensive and slow. Disable thinking for scan/extract/format roles; enable only for synthesis or architecture decisions.
2. **Temperature 1.0 in agentic loops** — non-deterministic tool ordering breaks reproducible workflows. Use `temperature: 0.6` for agent roles; reserve 1.0 for creative writing specialists.
3. **128K output limit surprises on long syntheses** — when merging docs or generating comprehensive analyses, output can hit the limit silently. Chunk syntheses at 100K tokens and emit multiple responses.
