# Shared Subagent Authoring Template

Reference for authoring `agents/<name>.md` subagent files.
All subagents are `mode: subagent` workers. They return data; they NEVER write `state.json`.

## Frontmatter schema

```yaml
---
description: <one-sentence intent-recognition: when a specialist should dispatch this>
mode: subagent
model: <from docs/routing-manifest.json subagents.<name>.primary>
temperature: <per-family: GLM 0.6 · Kimi 0.6 · MiniMax omit · Qwen 0.6 · DeepSeek omit on reasoner / 0.6 on flash · Gemini 1.0 · GPT omit>
permission:
  edit: deny              # subagents never write files (except code-runner: deny still)
  bash: deny              # ONLY code-runner gets bash: allow
  webfetch: <allow for retriever/fact-checker/explorer; deny others>
  websearch: <allow for retriever/fact-checker; deny others>
  task:                   # A3=GO: T1 subagents may dispatch T2 leaves only
    "*": deny             # denies all specialists + self by default
    extractor: allow      # add for subagents that do bulk pull (retriever, explorer, analyst, fact-checker)
    formatter: allow      # add for report builders (synthesizer, designer, technical-writer)
    # T2 leaves themselves get task: deny (no further dispatch)
  question: deny          # subagents NEVER ask; return needs-clarification: <topic> instead
  todowrite: allow
  skill:
    "*": deny
    html-preview: allow   # add only for synthesizer, designer
---
```

## XML body skeleton

```xml
<role>
One paragraph: who this agent is, what its value is, what it NEVER does.
</role>

<context>
Read docs/models/<family>.md before first turn.
Primary-only: you cannot call question. Return `needs-clarification: <topic>` with 2-4 options if input is ambiguous.
</context>

<input_contract>
List the brief fields required from the dispatching specialist:
- mission: <one-sentence task>
- scope: <...>
- evidence_standard: <...>
- output_contract: <exact sections to return>
</input_contract>

<workflow>
Step-by-step numbered workflow. Each step is concrete and tool-specific.
</workflow>

<output_contract>
Return exactly these sections (copy from the per-agent spec table):
...
</output_contract>

<constraints>
- Return data only. NEVER write state.json or any state file.
- NEVER dispatch another specialist.
- If input is materially ambiguous: return `needs-clarification: <topic>` with options.
</constraints>
```

## Rules

1. `model:` value must exactly match `docs/routing-manifest.json subagents.<name>.primary`
2. `permission.task` allow-list = T2 leaves only (extractor, formatter). NEVER include specialist names.
3. Only `code-runner` gets `bash: allow`. All others: `bash: deny`.
4. Subagents that return structured data to synthesis/report builders → include `extractor: allow` in task.
5. Subagents that produce report output → include `formatter: allow` in task.
6. T2 leaves (extractor, formatter) get `task: deny` — no further dispatch.
