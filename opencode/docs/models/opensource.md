# Opencode-Hosted Free Models Prompting Nuance

Active when model family is `opencode/*` (big-pickle, nemotron-3-super-free, deepseek-v4-flash-free, mimo-v2.5-free).

**Spread load.** Quotas are real but undocumented. Do not concentrate routine traffic on a single model.

---

## DeepSeek-V4 (`opencode/deepseek-v4-flash-free`)

**Strength:** math/STEM, numeric analysis, structured data transformations. Primary for `soroban--number-sage`; also used in `mikoshi--code-pathfinder` fallback chain.

### CO-STAR framework (recommended)

Structure prompts as:
```
Context: <background / what you know>
Objective: <precise task definition>
Style: <output style — bullet list, JSON, prose>
Tone: <neutral / technical / concise>
Audience: <who consumes this output>
Response: <explicit format instruction>
```

### Think modes

DeepSeek-V4 has two reasoning modes. The API selects automatically, but you can bias via phrasing:
- **Pro (deep reasoning):** use for multi-step math, logic puzzles, code correctness proofs. Phrasing: "Think step by step before answering."
- **Flash (fast):** use for lookup, extraction, format transforms. Phrasing: "Answer directly."

### Avoid heavy CoT examples

DeepSeek-V4 is an R1-style reasoning model — it generates its own chain-of-thought internally. Providing long CoT examples in the prompt wastes tokens and can degrade output quality by anchoring to your example reasoning. Provide the answer format, not the reasoning path.

---

## Nemotron-3-super (`opencode/nemotron-3-super-free`)

**Strength:** agentic reasoning, long-context research, iterative multi-step tasks. Fallback for `deep-researcher`, `legal-compliance`.
1M token context window. RL-tuned for AIME/TerminalBench — excels at tasks requiring iterative self-correction.

### Prompting

- Give it the full context upfront — it uses the 1M window effectively. No need to summarize or chunk.
- Explicit iteration instructions work well: "Attempt, then critique your attempt, then revise."
- For research tasks: list your acceptance criteria explicitly. Nemotron self-corrects toward stated criteria.
- Keep system instructions under 500 tokens — it front-loads task context over behavioral rules.

### Avoid

- Do NOT provide heavy CoT examples (R1-style; same reason as DeepSeek).
- Do NOT ask it to "be brief" on research tasks — it will skip important synthesis steps.

---

## MiMo-v2.5 (`opencode/mimo-v2.5-free`)

**Strength:** routine debugging passes, RL-tuned on agentic trajectories. Fallback for `@bakeneko--bug-hunter`.

### 4-part skeleton (recommended)

Structure every prompt as:
```
**Context:** <what system/codebase/environment>
**Task:** <precise action required>
**Guidelines:** <constraints, preferences, what to avoid>
**Constraints:** <hard limits — must-not, format required, length>
```

Placing all four explicitly improves MiMo's tool-call sequencing and reduces hallucinated tool names.

### Avoid heavy CoT examples

MiMo is RL-tuned — it generates its own trajectory. Long reasoning examples in the prompt confuse its policy. Give the skeleton, not the path.

---

## big-pickle (`opencode/big-pickle`)

**Strength:** broad codebase research, market/trend scans, general-purpose free fallback. Primary for `general` escape-hatch agent; fallback for `yamabiko--source-echo`, `mikoshi--code-pathfinder`, `henge--format-shifter`. 200K context.

### Prompting

- GPT-5-shaped prompting works: imperative style, role first, explicit output format.
- 200K context: give it the full relevant file set; it handles large inputs well.
- For research/scan tasks: state the output schema before the input corpus.

### Avoid

- Do not use for tasks requiring deep math or formal reasoning — route to DeepSeek or GPT workhorse instead.
- Do not use as a last resort for everything — it has a real (undocumented) quota. Reserve it for its primary roles.

---

## Your three most-likely failure modes per model

| Model | Failure mode 1 | Failure mode 2 | Failure mode 3 |
|---|---|---|---|
| DeepSeek-V4 | Heavy CoT example degrades output | CO-STAR skipped → vague task → vague answer | Math task sent to Flash mode → shallow result |
| Nemotron-3 | System prompt >500 tokens pushes out task context | "Be brief" instruction skips synthesis | No acceptance criteria → self-correction loops indefinitely |
| MiMo-v2.5 | Skeleton not provided → hallucinated tool names | Heavy example anchors wrong trajectory | Used for math → route to DeepSeek instead |
| big-pickle | Quota exhausted silently → degraded output, no error | Math/logic task sent here → shallow result | All free traffic piled on one model → quota cliff |
