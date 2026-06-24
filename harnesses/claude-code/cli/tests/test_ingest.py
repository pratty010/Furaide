import json
from pathlib import Path
import pytest
from mekiki import ingest, db, paths

FIXTURES = Path(__file__).parent / "fixtures"
PROJECTS_FIXTURES = FIXTURES / "projects"


# ── transcript-scan tests (new spine) ──────────────────────────────────────

def test_transcript_scan_creates_session(mekiki_home):
    db.init()
    counts = ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    sess = conn.execute("SELECT * FROM sessions WHERE session_id='sess1'").fetchone()
    assert sess is not None
    assert sess["platform"] == "claude-code"
    assert sess["cwd"] == "/tmp/proj"
    assert sess["ended_cleanly"] == 1
    conn.close()
    assert counts["sessions"] >= 1

def test_transcript_scan_creates_invocation(mekiki_home):
    db.init()
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    inv = conn.execute(
        "SELECT * FROM skill_invocations WHERE tool_use_id='toolu_bs1'"
    ).fetchone()
    assert inv is not None
    assert inv["skill"] == "brainstorming"
    assert inv["ts"] == "2026-06-01T10:00:01.000Z"
    conn.close()

def test_transcript_scan_derives_used_downstream(mekiki_home):
    db.init()
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    inv = conn.execute(
        "SELECT used_downstream FROM skill_invocations WHERE tool_use_id='toolu_bs1'"
    ).fetchone()
    assert inv["used_downstream"] == 1
    conn.close()

def test_transcript_scan_is_idempotent(mekiki_home):
    db.init()
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    count = conn.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()["c"]
    assert count == 1
    conn.close()

def test_transcript_scan_detects_user_typed_trigger(mekiki_home):
    proj_dir = mekiki_home / "fake_projects" / "-slug-"
    proj_dir.mkdir(parents=True)
    jpath = proj_dir / "sess-cmd.jsonl"
    jpath.write_text(
        json.dumps({"type": "user", "uuid": "u1", "sessionId": "sess-cmd", "parentUuid": None,
                    "timestamp": "2026-06-01T09:00:00.000Z", "cwd": "/tmp",
                    "message": {"role": "user", "content": "<command-name>/brainstorming</command-name> build it"}}) + "\n" +
        json.dumps({"type": "assistant", "uuid": "a1", "parentUuid": "u1", "sessionId": "sess-cmd",
                    "timestamp": "2026-06-01T09:00:01.000Z",
                    "message": {"role": "assistant", "content": [
                        {"type": "tool_use", "id": "toolu_cmd1", "name": "Skill",
                         "input": {"skill": "brainstorming", "args": ""}}]}}) + "\n"
    )
    db.init()
    ingest.run_transcript_scan(projects_root=mekiki_home / "fake_projects")
    conn = db.connect()
    inv = conn.execute(
        "SELECT trigger FROM skill_invocations WHERE tool_use_id='toolu_cmd1'"
    ).fetchone()
    assert inv["trigger"] == "user-typed"
    conn.close()


# ── legacy hook-based tests (kept for run_hooks) ────────────────────────────

def _write_hook_events(mekiki_home, lines):
    f = mekiki_home / "events" / "claude-code" / "2026-05-27.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("\n".join(json.dumps(l) for l in lines) + "\n")

def test_run_hooks_creates_session(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_hook_events(mekiki_home, [
        {"ts": "2026-05-27T10:00:00.000Z", "platform": "claude-code", "event": "session.start",
         "session_id": "s-hook", "cwd": "/tmp", "model": "claude-haiku-4-5-20251001",
         "source": "startup", "transcript_path": transcript_path},
    ])
    ingest.run_hooks()
    conn = db.connect()
    sess = conn.execute("SELECT * FROM sessions WHERE session_id='s-hook'").fetchone()
    assert sess is not None
    conn.close()

def test_run_hooks_marks_effort_level(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_hook_events(mekiki_home, [
        {"ts": "2026-05-27T10:00:00.000Z", "platform": "claude-code", "event": "session.start",
         "session_id": "s-eff", "cwd": "/tmp", "model": "claude-haiku-4-5-20251001",
         "source": "startup", "transcript_path": transcript_path},
        {"ts": "2026-05-27T10:00:01.000Z", "platform": "claude-code",
         "event": "skill.user_typed", "session_id": "s-eff",
         "skill": "brainstorming", "effort_level": "high",
         "transcript_path": transcript_path},
    ])
    ingest.run_hooks()
    conn = db.connect()
    sess = conn.execute(
        "SELECT effort_level FROM sessions WHERE session_id='s-eff'"
    ).fetchone()
    assert sess["effort_level"] == "high"
    conn.close()
