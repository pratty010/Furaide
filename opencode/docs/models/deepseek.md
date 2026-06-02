# DeepSeek V4 Prompting Nuance

Active when model family is `opencode-go/deepseek-v4-pro` [reasoner], `opencode-go/deepseek-v4-flash` [chat].

---

## Two distinct variants — different rules

**DeepSeek V4 has two separate model personalities. Choose based on the task:**

- **`deepseek-v4-pro`** — reasoner. Thinks before answering. For novel problems, adversarial review, architecture decisions.
- **`deepseek-v4-flash`** — chat. Fast, tool-capable. For data analysis, interactive queries, multi-turn workflows.

---

## Reasoner (`deepseek-v4-pro`) — detailed rules

### Output format

- Returns `reasoning_content` (internal thinking) separate from `content` (the answer).
- Example: `{"reasoning_content": "Step 1: …", "content": "Based on my reasoning: …"}`

### CRITICAL: Excluding reasoning from next turn

**Do NOT re-send `reasoning_content` in the next turn's input.** Doing so causes a 400 error.

- Extract only the `content` field from the reasoner's response.
- Include only `content` in the next turn's history.
- **Consequence:** Sending reasoning_content back triggers validation error and breaks the session.

### Parameters that DON'T work on reasoner

- **`temperature`, `top_p`, `top_k`, `frequency_penalty`, `presence_penalty`** — setting them has **no effect**. The reasoner ignores all sampling parameters.
- Do not waste tokens configuring them. The model uses fixed internal sampling.

### System prompts and examples

- **No system prompt.** Put all instructions in the first user message.
- **No few-shot or CoT examples.** They degrade reasoner output. The reasoner works best with minimal context and instruction.
- Do NOT write "reason step by step" or "think deeply" — the model reasons automatically. State the task plainly.

### Output limits

- **32K tokens default; 64K tokens maximum.** Plan long analyses accordingly.
- If analysis exceeds 32K, the response is truncated. For comprehensive reports, chunk the analysis (e.g., "analyze part 1 of the codebase" then "analyze part 2").

### No function-calling on reasoner

- **The reasoner does NOT execute tools directly.** For tool-dependent workflows:
  1. Reasoner outputs a hypothesis or plan (e.g., "To validate this, I need to execute: `python analyze.py --depth=3`").
  2. **Emit an `ExecutionPacket`** with the code/command.
  3. **Route to `@code-runner`** for execution.
  4. `code-runner` executes and returns stdout/stderr.
  5. Reasoner consumes the result in the next turn (as `content` only, no reasoning_content).

**ExecutionPacket schema** (what the reasoner emits for code-runner):
```json
{
  "hypothesis": "string — the root-cause hypothesis being tested",
  "files": ["path/to/file1", "path/to/file2"],
  "commands": ["bash command or python snippet to run"],
  "expected_observations": "what stdout/stderr should show if hypothesis is correct",
  "stop_criteria": "condition under which no further execution is needed"
}
```
`@code-runner` (or any code-execution subagent) executes the `commands`, captures stdout/stderr, and returns them as plain `content` for the reasoner's next turn.

---

## Chat (`deepseek-v4-flash`) — rules

- **Tool-capable.** Use for data-analyst and interactive roles.
- Supports system prompt and messages.
- **Recommended sampling:** `temperature: 0.6`, `top_p: 0.95`.
- Standard function-calling schema (OpenAI-compatible).

---

## Cross-agent pattern: reasoner + code-runner

**Typical workflow:**

1. **Reasoner** — receives task, produces hypothesis + ExecutionPacket (e.g., bash command or Python snippet).
2. **ExecutionPacket emitter** — formats the code/command with inputs and outputs schema.
3. **code-runner** — executes the packet, returns stdout/stderr.
4. **Reasoner** (next turn) — receives execution result as plain content; re-analyzes and iterates or concludes.

This pattern decouples reasoning from execution and allows the reasoner to focus on problem-solving.

---

## Your three most-likely failure modes

1. **Sending `reasoning_content` back = 400 error** — if you include the reasoning block in the next turn's input, the API rejects it. Always strip reasoning; send only `content`.
2. **Setting temperature on reasoner = silent no-op** — you think you've tuned sampling, but the reasoner ignores the parameter. Do not waste time; accept the fixed sampling and focus on prompt clarity instead.
3. **Adding system prompt to reasoner = ignored or degraded output** — the reasoner does not process system prompts. Move all instructions into the first user message. Few-shot examples also degrade reasoner output; avoid them.
