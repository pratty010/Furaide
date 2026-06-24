from mekiki.judge.interface import InvocationContext, AvailableSkillCtx

GEVAL_STEPS_SYSTEM = (
    "You are an expert evaluator designing a scoring rubric for a Claude Code skill invocation. "
    "Given the skill name, args, trigger, and conversation context, generate exactly 3 to 5 "
    "specific evaluation criteria as a JSON array of strings. "
    "Each criterion must be answerable from the conversation alone — concrete, not vague. "
    "Respond with a JSON array and nothing else."
)

GEVAL_SCORE_SYSTEM = (
    "You are an expert evaluator scoring a single criterion for a Claude Code skill invocation. "
    "Score on a scale of 0-10:\n"
    "  0-2: criterion clearly not met\n"
    "  3-5: criterion partially met or ambiguous\n"
    "  6-8: criterion mostly met\n"
    "  9-10: criterion fully and clearly met\n"
    'Respond with a JSON object: {"score": <integer 0-10>, "reasoning": "<brief explanation>"}'
)

GAP_SYSTEM = (
    "You analyze whether a Claude Code session is missing a skill invocation that "
    "*should* have happened. Given a user prompt and the list of installed skills with their "
    "descriptions, decide whether exactly one of the listed skills clearly should have been invoked "
    "in response. Be conservative: only flag clear cases. If no skill clearly fits, return null. "
    "Respond with a single JSON object and nothing else, using exactly these keys: "
    "suggested_skill (string skill name from the list, or null), "
    'reasoning (string explaining the match, or "").'
)


def geval_steps_prompt(ctx: InvocationContext) -> str:
    return (
        f"Skill: {ctx.skill}\n"
        f"Args: {ctx.args}\n"
        f"Trigger: {ctx.trigger}\n\n"
        f"Conversation BEFORE invocation:\n"
        f"{chr(10).join(ctx.context_before) or '(none)'}\n\n"
        f"Conversation AFTER invocation:\n"
        f"{chr(10).join(ctx.context_after) or '(none)'}\n\n"
        "Generate 3-5 evaluation criteria for whether this skill invocation was helpful. "
        "JSON array only."
    )


def geval_score_prompt(criterion: str, ctx: InvocationContext) -> str:
    return (
        f"Criterion: {criterion}\n\n"
        f"Skill invoked: {ctx.skill}\n"
        f"Args: {ctx.args}\n"
        f"Trigger: {ctx.trigger}\n\n"
        f"Conversation BEFORE invocation:\n"
        f"{chr(10).join(ctx.context_before) or '(none)'}\n\n"
        f"Conversation AFTER invocation:\n"
        f"{chr(10).join(ctx.context_after) or '(none)'}\n\n"
        "Score this criterion 0-10. JSON only."
    )


def gap_user_prompt(prompt: str, available: list[AvailableSkillCtx]) -> str:
    skills_block = "\n".join(f"- {s.name}: {s.description}" for s in available)
    return (
        f"Available skills:\n{skills_block}\n\n"
        f'User prompt:\n"""\n{prompt}\n"""\n\n'
        "Should any of the available skills have been invoked? JSON only."
    )
