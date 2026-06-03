from pathlib import Path
from mekiki import db
from mekiki.judge import orchestrator
from mekiki.judge.interface import Judgment, Gap, AvailableSkillCtx

FIXTURES = Path(__file__).parent / "fixtures"

class FakeBackend:
    def classify_invocation(self, ctx):
        return Judgment(
            used_downstream=True, user_reaction="positive",
            user_reaction_quote="thanks", session_ended_cleanly=True,
            notes="ok", judgment_model="fake",
        )
    def detect_gap(self, prompt, available_skills):
        return None

def test_orchestrator_judges_only_new_invocations(mekiki_home):
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
    conn.close()

    orchestrator.judge_invocations(FakeBackend())
    orchestrator.judge_invocations(FakeBackend())  # second run should not duplicate
    conn = db.connect()
    rows = conn.execute("SELECT COUNT(*) c FROM invocation_judgments").fetchone()
    assert rows["c"] == 1
    j = conn.execute("SELECT * FROM invocation_judgments").fetchone()
    assert j["user_reaction"] == "positive"
    assert j["judgment_model"] == "fake"
    conn.close()
