from pathlib import Path
from satori.judge import context as ctxmod
from satori import db

FIXTURES = Path(__file__).parent / "fixtures"

def test_build_context_around_invocation(satori_home):
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

    ic = ctxmod.build(inv_id, before=2, after=0)
    assert ic.skill == "brainstorming"
    assert ic.turn_index == 3
    assert len(ic.context_before) == 2
    assert "use brainstorming" in ic.context_before[-1]
