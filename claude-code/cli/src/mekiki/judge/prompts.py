from mekiki.judge.interface import InvocationContext, AvailableSkillCtx

CLASSIFY_SYSTEM = """You are an analyst evaluating whether a Claude Code skill invocation was helpful. \
Given the conversation context around the invocation, classify the outcome strictly. \
Respond with a single JSON object and nothing else, using exactly these keys: \
used_downstream (true|false|null), user_reaction (one of "positive","negative","neutral","none"), \
user_reaction_quote (string; verbatim user quote that justified the reaction, or ""), \
session_ended_cleanly (true|false|null), notes (short string)."""

def classify_user_prompt(ctx: InvocationContext) -> str:
    before = "\n".join(ctx.context_before) or "(no preceding turns)"
    after = "\n".join(ctx.context_after) or "(no following turns)"
    return f"""Skill invoked: {ctx.skill}
Args: {ctx.args}
Trigger: {ctx.trigger}

Conversation BEFORE invocation:
{before}

Conversation AFTER invocation:
{after}

Classify the outcome per the system instructions. JSON only."""

GAP_SYSTEM = """You analyze whether a Claude Code session is missing a skill invocation that \
*should* have happened. Given a user prompt and the list of installed skills with their \
descriptions, decide whether exactly one of the listed skills clearly should have been invoked \
in response. Be conservative: only flag clear cases. If no skill clearly fits, return null. \
Respond with a single JSON object and nothing else, using exactly these keys: \
suggested_skill (string skill name from the list, or null), \
reasoning (string explaining the match, or "")."""

def gap_user_prompt(prompt: str, available: list[AvailableSkillCtx]) -> str:
    skills_block = "\n".join(f"- {s.name}: {s.description}" for s in available)
    return f"""Available skills:
{skills_block}

User prompt:
\"\"\"
{prompt}
\"\"\"

Should any of the available skills have been invoked? JSON only."""
