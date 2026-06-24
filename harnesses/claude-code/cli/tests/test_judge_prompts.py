from mekiki.judge import prompts
from mekiki.judge.interface import InvocationContext, AvailableSkillCtx


def _make_ctx():
    return InvocationContext(
        invocation_id=1,
        session_id="s1",
        skill="brainstorming",
        args="design mekiki",
        trigger="user-typed",
        turn_index=1,
        context_before=["[user] use brainstorming"],
        context_after=["[user] looks good", "[assistant] great"],
    )


def test_geval_steps_prompt_includes_skill():
    ctx = _make_ctx()
    p = prompts.geval_steps_prompt(ctx)
    assert "brainstorming" in p
    assert "design mekiki" in p


def test_geval_score_prompt_includes_criterion_and_context():
    ctx = _make_ctx()
    p = prompts.geval_score_prompt("Was the right skill chosen?", ctx)
    assert "Was the right skill chosen?" in p
    assert "brainstorming" in p
    assert "use brainstorming" in p


def test_geval_steps_system_requests_json_array():
    assert "JSON" in prompts.GEVAL_STEPS_SYSTEM
    assert "array" in prompts.GEVAL_STEPS_SYSTEM.lower()


def test_geval_score_system_defines_ranges():
    assert "0-10" in prompts.GEVAL_SCORE_SYSTEM or "0–10" in prompts.GEVAL_SCORE_SYSTEM


def test_gap_system_unchanged():
    assert "suggested_skill" in prompts.GAP_SYSTEM
    assert "reasoning" in prompts.GAP_SYSTEM


def test_gap_user_prompt_includes_skill_list():
    skills = [AvailableSkillCtx(name="brainstorming", description="for design tasks")]
    p = prompts.gap_user_prompt("I want to design something", skills)
    assert "brainstorming" in p
    assert "I want to design something" in p


def test_classify_system_removed():
    assert not hasattr(prompts, "CLASSIFY_SYSTEM"), "CLASSIFY_SYSTEM should be removed"
