import json
from pathlib import Path
from mekiki import ingest, db, paths

FIXTURES = Path(__file__).parent / "fixtures"

def _write_events(mekiki_home, lines):
    f = mekiki_home / "events" / "claude-code" / "2026-05-27.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("\n".join(json.dumps(l) for l in lines) + "\n")

def test_ingest_creates_session_and_invocation(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_events(mekiki_home, [
        {"ts":"2026-05-27T10:00:00.000Z","platform":"claude-code","event":"session.start",
         "session_id":"s1","cwd":"/tmp","model":"claude-opus-4-7","source":"startup",
         "transcript_path":transcript_path},
        {"ts":"2026-05-27T10:00:03.000Z","platform":"claude-code","event":"skill.invoke",
         "session_id":"s1","cwd":"/tmp","skill":"brainstorming","args":"",
         "tool_use_id":"toolu_x","transcript_path":transcript_path},
        {"ts":"2026-05-27T10:00:04.000Z","platform":"claude-code","event":"skill.loaded",
         "session_id":"s1","tool_use_id":"toolu_x","exit_code":0,"run_time_seconds":0.42},
    ])
    ingest.run()
    conn = db.connect()
    sess = conn.execute("SELECT * FROM sessions WHERE session_id='s1'").fetchone()
    assert sess["model"] == "claude-opus-4-7"
    inv = conn.execute("SELECT * FROM skill_invocations WHERE tool_use_id='toolu_x'").fetchone()
    assert inv["skill"] == "brainstorming"
    assert inv["load_success"] == 1
    assert inv["load_duration_ms"] == 420
    assert inv["turn_index"] == 3

def test_ingest_is_idempotent(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_events(mekiki_home, [
        {"ts":"2026-05-27T10:00:00.000Z","platform":"claude-code","event":"session.start",
         "session_id":"s1","cwd":"/tmp","model":"claude-opus-4-7","source":"startup",
         "transcript_path":transcript_path},
    ])
    ingest.run()
    ingest.run()
    conn = db.connect()
    count = conn.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()["c"]
    assert count == 1

def test_ingest_marks_user_typed_trigger(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_events(mekiki_home, [
        {"ts":"2026-05-27T10:00:00.000Z","platform":"claude-code","event":"session.start",
         "session_id":"s1","cwd":"/tmp","model":"claude-opus-4-7","source":"startup",
         "transcript_path":transcript_path},
        {"ts":"2026-05-27T10:00:02.500Z","platform":"claude-code","event":"skill.user_typed",
         "session_id":"s1","skill":"brainstorming","transcript_path":transcript_path},
        {"ts":"2026-05-27T10:00:03.000Z","platform":"claude-code","event":"skill.invoke",
         "session_id":"s1","cwd":"/tmp","skill":"brainstorming","args":"",
         "tool_use_id":"toolu_x","transcript_path":transcript_path},
    ])
    ingest.run()
    conn = db.connect()
    inv = conn.execute("SELECT trigger FROM skill_invocations WHERE tool_use_id='toolu_x'").fetchone()
    assert inv["trigger"] == "user-typed"
