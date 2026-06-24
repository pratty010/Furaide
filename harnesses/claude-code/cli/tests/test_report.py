# cli/tests/test_report.py
from mekiki import db
from mekiki.report import generate

def _seed(conn):
    conn.execute("INSERT INTO sessions(session_id,platform,started_at,last_seen_at) "
                 "VALUES('s1','claude-code','2026-05-27T10:00:00Z','2026-05-27T11:00:00Z')")
    conn.execute("INSERT INTO skill_invocations(session_id,ts,skill,tool_use_id,turn_index,trigger,load_success) "
                 "VALUES('s1','2026-05-27T10:00:00Z','brainstorming','toolu_x',3,'model',1)")
    inv = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    conn.execute("INSERT INTO invocation_judgments(invocation_id,used_downstream,user_reaction,"
                 "user_reaction_quote,judgment_model,judged_at) "
                 "VALUES(?,1,'positive','perfect','fake','2026-05-27T11:00:00Z')", (inv,))
    conn.execute("INSERT INTO skill_stats(skill,window,invocations,positive,negative,neutral,"
                 "none_reaction,load_failures,user_typed,model_triggered,computed_at) "
                 "VALUES('brainstorming','all',1,1,0,0,0,0,0,1,'2026-05-27T11:00:00Z')")
    conn.commit()

def test_overview_renders(mekiki_home):
    db.init()
    conn = db.connect(); _seed(conn); conn.close()
    out = generate.overview()
    text = out.read_text()
    assert "brainstorming" in text
    assert "Invocations" in text or "invocations" in text
    assert out.suffix == ".html"

def test_skill_detail_renders(mekiki_home):
    db.init()
    conn = db.connect(); _seed(conn); conn.close()
    out = generate.skill_detail("brainstorming")
    text = out.read_text()
    assert "brainstorming" in text
    assert "perfect" in text
