from mekiki import events, paths
from mekiki.paths import events_dir

def test_iter_events_reads_all_jsonl_lines(mekiki_home):
    d = events_dir()
    f1 = d / "2026-05-26.jsonl"
    f1.write_text(
        '{"ts":"2026-05-26T10:00:00.000Z","platform":"claude-code","event":"session.start","session_id":"s1"}\n'
        '{"ts":"2026-05-26T10:00:01.000Z","platform":"claude-code","event":"skill.invoke","session_id":"s1","skill":"brainstorming"}\n'
    )
    f2 = d / "2026-05-27.jsonl"
    f2.write_text(
        '{"ts":"2026-05-27T09:00:00.000Z","platform":"claude-code","event":"turn.stop","session_id":"s1"}\n'
    )
    out = list(events.iter_new(platform="claude-code"))
    assert len(out) == 3
    assert out[0]["event"] == "session.start"
    assert out[2]["event"] == "turn.stop"

def test_iter_events_respects_checkpoints(mekiki_home):
    from mekiki import db
    db.init()
    d = events_dir()
    f = d / "2026-05-26.jsonl"
    line1 = '{"ts":"2026-05-26T10:00:00.000Z","platform":"claude-code","event":"session.start","session_id":"s1"}\n'
    line2 = '{"ts":"2026-05-26T10:00:01.000Z","platform":"claude-code","event":"skill.invoke","session_id":"s1","skill":"brainstorming"}\n'
    f.write_text(line1)
    out1 = list(events.iter_new(platform="claude-code"))
    assert len(out1) == 1
    events.checkpoint(str(f), len(line1.encode()))
    with f.open("a") as fh:
        fh.write(line2)
    out2 = list(events.iter_new(platform="claude-code"))
    assert len(out2) == 1
    assert out2[0]["event"] == "skill.invoke"
