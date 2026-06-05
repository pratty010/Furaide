from pathlib import Path
from mekiki import transcript

FIXTURES = Path(__file__).parent / "fixtures"

def test_iter_turns_yields_user_and_assistant():
    turns = list(transcript.iter_turns(FIXTURES / "transcript_simple.jsonl"))
    assert len(turns) == 4
    assert turns[0].role == "user"
    assert turns[3].role == "assistant"
    assert turns[3].turn_index == 3

def test_find_skill_invocations_extracts_tool_use():
    invs = list(transcript.iter_skill_invocations(FIXTURES / "transcript_simple.jsonl"))
    assert len(invs) == 1
    assert invs[0].skill == "brainstorming"
    assert invs[0].tool_use_id == "toolu_x"
    assert invs[0].turn_index == 3

def test_detect_compact_boundary():
    boundary = transcript.detect_compact_boundary(FIXTURES / "transcript_with_compact.jsonl")
    assert boundary == 2

def test_detect_compact_boundary_none():
    boundary = transcript.detect_compact_boundary(FIXTURES / "transcript_simple.jsonl")
    assert boundary is None

def test_window_around_turn():
    turns = list(transcript.iter_turns(FIXTURES / "transcript_simple.jsonl"))
    window = transcript.window_around(turns, target_index=3, before=2, after=0)
    assert [t.turn_index for t in window] == [1, 2, 3]

def test_extract_available_skills():
    skills = transcript.extract_available_skills(
        FIXTURES / "transcript_with_skills_reminder.jsonl"
    )
    assert {s.name for s in skills} == {"brainstorming", "diagnose", "writing-plans"}
    by_name = {s.name: s.description for s in skills}
    assert "non-trivial task" in by_name["brainstorming"]
    assert "debugging" in by_name["diagnose"]

def test_extract_session_meta_prefers_in_record_session_id():
    meta = transcript.extract_session_meta(FIXTURES / "transcript_with_attribution.jsonl")
    assert meta.session_id == "sess-attr"   # from in-record sessionId, NOT filename stem
    assert meta.cwd == "/tmp/proj"
    assert meta.started_at == "2026-06-01T10:00:00.000Z"
    assert meta.ended_cleanly is True

def test_extract_session_meta_no_stop_hook():
    meta = transcript.extract_session_meta(FIXTURES / "transcript_simple.jsonl")
    assert meta.ended_cleanly is False

def test_turn_bounded_window_returns_block_between_human_messages():
    turns = list(transcript.iter_turns(FIXTURES / "transcript_with_attribution.jsonl"))
    # target_turn_index=1 is the assistant Skill tool_use record
    # block runs from human message at turn_index=0 to before human message at turn_index=4
    window = transcript.turn_bounded_window(turns, target_turn_index=1)
    indices = [t.turn_index for t in window]
    assert 0 in indices   # human prompt included
    assert 1 in indices   # Skill tool_use included
    assert 2 in indices   # tool_result included
    assert 3 in indices   # downstream assistant included
    assert 4 not in indices  # next human message excluded

def test_derive_downstream_used_detects_attribution():
    turns = list(transcript.iter_turns(FIXTURES / "transcript_with_attribution.jsonl"))
    invocations = list(transcript.iter_skill_invocations(FIXTURES / "transcript_with_attribution.jsonl"))
    result = transcript.derive_downstream_used(invocations, turns)
    assert result["toolu_bs1"] is True

def test_skill_invocation_has_ts():
    invs = list(transcript.iter_skill_invocations(FIXTURES / "transcript_with_attribution.jsonl"))
    assert len(invs) == 1
    assert invs[0].ts == "2026-06-01T10:00:01.000Z"

def test_turn_bounded_window_orphan_guard():
    """R4: when no human message precedes the target, start at the target's own position."""
    from mekiki.transcript import Turn, turn_bounded_window
    turns = [
        Turn(turn_index=0, uuid="a0", parent_uuid=None, role="assistant", timestamp="", text="preamble", raw={}),
        Turn(turn_index=1, uuid="a1", parent_uuid=None, role="assistant", timestamp="", text="target", raw={}),
        Turn(turn_index=2, uuid="u0", parent_uuid=None, role="user", timestamp="", text="first human", raw={}),
    ]
    window = turn_bounded_window(turns, target_turn_index=1)
    indices = [t.turn_index for t in window]
    # Must NOT include turn 0 (that would be the "swallow file head" bug)
    assert 0 not in indices, "orphan guard must not include preamble before target"
    assert 1 in indices


def test_derive_downstream_used_respects_next_invocation_bound():
    """Attribution for a skill invocation must not bleed into the next same-skill invocation."""
    from mekiki.transcript import Turn, SkillInvocation, derive_downstream_used
    turns = [
        Turn(turn_index=0, uuid="u0", parent_uuid=None, role="user", timestamp="", text="", raw={}),
        Turn(turn_index=1, uuid="a1", parent_uuid=None, role="assistant", timestamp="", text="", raw={}),
        Turn(turn_index=2, uuid="u1", parent_uuid=None, role="user", timestamp="", text="", raw={}),
        Turn(turn_index=3, uuid="a2", parent_uuid=None, role="assistant", timestamp="",
             text="", raw={"attributionSkill": "brainstorming"}),
        Turn(turn_index=4, uuid="u2", parent_uuid=None, role="user", timestamp="", text="", raw={}),
        Turn(turn_index=5, uuid="a3", parent_uuid=None, role="assistant", timestamp="", text="", raw={}),
        Turn(turn_index=6, uuid="u3", parent_uuid=None, role="user", timestamp="", text="", raw={}),
        Turn(turn_index=7, uuid="a4", parent_uuid=None, role="assistant", timestamp="",
             text="", raw={"attributionSkill": "brainstorming"}),
    ]
    invocations = [
        SkillInvocation(turn_index=1, tool_use_id="id1", skill="brainstorming", args=""),
        SkillInvocation(turn_index=5, tool_use_id="id2", skill="brainstorming", args=""),
    ]
    result = derive_downstream_used(invocations, turns)
    assert result["id1"] is True   # turn 3 attributionSkill=brainstorming, before turn 5 bound
    assert result["id2"] is True   # turn 7 attributionSkill=brainstorming, no upper bound
