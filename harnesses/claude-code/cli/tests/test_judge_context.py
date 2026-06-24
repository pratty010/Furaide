from pathlib import Path
from mekiki.judge import context as ctxmod
from mekiki import db

FIXTURES = Path(__file__).parent / "fixtures"

def test_build_context_around_invocation(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    conn = db.connect()
    conn.execute(
        "INSERT INTO sessions(session_id,platform,started_at,last_seen_at,transcript_path) "
        "VALUES('s1','claude-code','2026-05-27T10:00:00.000Z','2026-05-27T10:00:03.000Z',?)",
        (transcript_path,)
    )
    conn.execute(
        "INSERT INTO skill_invocations(session_id,ts,skill,tool_use_id,turn_index,trigger) "
        "VALUES('s1','2026-05-27T10:00:03.000Z','brainstorming','toolu_x',3,'model')"
    )
    conn.commit()
    inv_id = conn.execute(
        "SELECT id FROM skill_invocations WHERE tool_use_id='toolu_x'"
    ).fetchone()["id"]
    conn.close()

    ic = ctxmod.build(inv_id)
    assert ic.skill == "brainstorming"
    assert ic.turn_index == 3
    assert len(ic.context_before) >= 1
    assert "use brainstorming" in ic.context_before[-1]


def test_build_uses_turn_bounded_window(mekiki_home):
    """context.build() must use turn_bounded_window, not window_around."""
    import inspect
    from mekiki.judge import context
    src = inspect.getsource(context)
    assert "turn_bounded_window" in src, "context.py must use turn_bounded_window"
    assert "window_around" not in src, "context.py must not call window_around"


def test_build_raises_key_error_on_null_turn_index(mekiki_home):
    """R3: turn_index=None must raise KeyError, not silently coerce to 0."""
    import pytest
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    conn = db.connect()
    conn.execute(
        "INSERT INTO sessions(session_id,platform,started_at,last_seen_at,transcript_path) "
        "VALUES('s_null','claude-code','2026-05-27T10:00:00.000Z','2026-05-27T10:00:03.000Z',?)",
        (transcript_path,)
    )
    conn.execute(
        "INSERT INTO skill_invocations(session_id,ts,skill,tool_use_id,trigger) "
        "VALUES('s_null','2026-05-27T10:00:03.000Z','brainstorming','toolu_null','model')"
    )
    conn.commit()
    inv_id = conn.execute(
        "SELECT id FROM skill_invocations WHERE tool_use_id='toolu_null'"
    ).fetchone()["id"]
    conn.close()

    with pytest.raises(KeyError):
        ctxmod.build(inv_id)
