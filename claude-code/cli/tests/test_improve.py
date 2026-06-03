# cli/tests/test_improve.py
from mekiki import db, improve

def _seed(conn):
    conn.execute("INSERT INTO sessions(session_id,platform,started_at,last_seen_at,transcript_path) "
                 "VALUES('s1','claude-code','2026-05-27T10:00:00Z','2026-05-27T11:00:00Z','/tmp/t')")
    # 20 positive + 5 negative invocations of brainstorming
    for i in range(20):
        conn.execute("INSERT INTO skill_invocations(session_id,ts,skill,tool_use_id,turn_index,trigger,load_success) "
                     "VALUES('s1','2026-05-27T10:00:00Z','brainstorming',?,?,'model',1)",
                     (f"toolu_p{i}", i))
        inv_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.execute("INSERT INTO invocation_judgments(invocation_id,used_downstream,user_reaction,"
                     "user_reaction_quote,judgment_model,judged_at) "
                     "VALUES(?,1,'positive','perfect','fake','2026-05-27T11:00:00Z')", (inv_id,))
    for i in range(5):
        conn.execute("INSERT INTO skill_invocations(session_id,ts,skill,tool_use_id,turn_index,trigger,load_success) "
                     "VALUES('s1','2026-05-27T10:00:00Z','brainstorming',?,?,'model',1)",
                     (f"toolu_n{i}", 100 + i))
        inv_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.execute("INSERT INTO invocation_judgments(invocation_id,used_downstream,user_reaction,"
                     "user_reaction_quote,judgment_model,judged_at) "
                     "VALUES(?,0,'negative','wrong skill','fake','2026-05-27T11:00:00Z')", (inv_id,))
    conn.commit()

def test_evidence_pack_generated(mekiki_home):
    db.init()
    conn = db.connect()
    _seed(conn)
    conn.close()

    pack_path = improve.build_evidence_pack("brainstorming")
    assert pack_path.exists()
    body = pack_path.read_text()
    assert "brainstorming" in body
    assert "Positive exemplars" in body
    assert "Negative exemplars" in body
    assert "perfect" in body
    assert "wrong skill" in body

    conn = db.connect()
    row = conn.execute("SELECT * FROM skill_improvements WHERE skill='brainstorming'").fetchone()
    assert row["status"] == "evidence_ready"
    assert row["evidence_path"] == str(pack_path)
    conn.close()

def test_mark_status(mekiki_home):
    db.init()
    conn = db.connect()
    _seed(conn)
    conn.close()
    pack_path = improve.build_evidence_pack("brainstorming")
    improve.mark_status("brainstorming", "applied")
    conn = db.connect()
    row = conn.execute(
        "SELECT status FROM skill_improvements WHERE skill='brainstorming' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert row["status"] == "applied"
    conn.close()

def test_insufficient_sample_raises(mekiki_home):
    db.init()
    try:
        improve.build_evidence_pack("nonexistent-skill")
    except improve.InsufficientSampleError:
        return
    raise AssertionError("expected InsufficientSampleError")
