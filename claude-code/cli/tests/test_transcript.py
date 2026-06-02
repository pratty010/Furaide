from pathlib import Path
from satori import transcript

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
