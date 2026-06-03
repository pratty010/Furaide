import sys
from datetime import datetime, timezone
from pathlib import Path
from mekiki import db, transcript
from mekiki.judge import context
from mekiki.judge.interface import JudgeBackend, AvailableSkillCtx
from mekiki import config as config_mod

def _unjudged_invocations(conn) -> list[int]:
    rows = conn.execute(
        "SELECT id FROM skill_invocations si "
        "WHERE NOT EXISTS (SELECT 1 FROM invocation_judgments j WHERE j.invocation_id = si.id) "
        "ORDER BY id"
    ).fetchall()
    return [r["id"] for r in rows]

def judge_invocations(backend: JudgeBackend, reanalyze_skill: str | None = None) -> int:
    cfg = config_mod.load().judge
    db.init()
    conn = db.connect()
    judged = 0
    try:
        if reanalyze_skill == "all":
            conn.execute("DELETE FROM invocation_judgments")
        elif reanalyze_skill:
            conn.execute(
                "DELETE FROM invocation_judgments WHERE invocation_id IN "
                "(SELECT id FROM skill_invocations WHERE skill = ?)",
                (reanalyze_skill,),
            )
        conn.commit()
        ids = _unjudged_invocations(conn)
        for inv_id in ids:
            try:
                ctx = context.build(inv_id, before=cfg.context_window_messages, after=cfg.context_window_messages)
                j = backend.classify_invocation(ctx)
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT INTO invocation_judgments(invocation_id, used_downstream, user_reaction, "
                    "user_reaction_quote, session_ended_cleanly, judgment_model, judged_at, notes) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        inv_id,
                        None if j.used_downstream is None else (1 if j.used_downstream else 0),
                        j.user_reaction, j.user_reaction_quote,
                        None if j.session_ended_cleanly is None else (1 if j.session_ended_cleanly else 0),
                        j.judgment_model, now, j.notes,
                    ),
                )
                conn.commit()
                judged += 1
            except Exception as e:
                print(f"[mekiki] judge skipped {inv_id}: {e}", file=sys.stderr)
                continue
    finally:
        conn.close()
    return judged

def detect_gaps(backend: JudgeBackend, sample_rate: float = 1.0) -> int:
    db.init()
    conn = db.connect()
    found = 0
    try:
        sessions = conn.execute(
            "SELECT session_id, transcript_path FROM sessions WHERE transcript_path IS NOT NULL"
        ).fetchall()
        for sess in sessions:
            tp = Path(sess["transcript_path"])
            if not tp.exists():
                continue
            avail_rows = conn.execute(
                "SELECT skill_name, skill_description FROM available_skills_at_session WHERE session_id = ?",
                (sess["session_id"],),
            ).fetchall()
            if not avail_rows:
                continue
            available = [
                AvailableSkillCtx(name=r["skill_name"], description=r["skill_description"] or "")
                for r in avail_rows
            ]
            invocation_turns = {inv.turn_index for inv in transcript.iter_skill_invocations(tp)}
            for turn in transcript.iter_turns(tp):
                if turn.role != "user":
                    continue
                if (turn.turn_index + 1) in invocation_turns:
                    continue
                exists = conn.execute(
                    "SELECT 1 FROM gap_findings WHERE session_id=? AND turn_index=? LIMIT 1",
                    (sess["session_id"], turn.turn_index),
                ).fetchone()
                if exists:
                    continue
                gap = backend.detect_gap(turn.text, available)
                if gap is None:
                    continue
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT OR IGNORE INTO gap_findings(session_id, turn_index, prompt_excerpt, "
                    "suggested_skill, reasoning, judgment_model, judged_at) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?)",
                    (
                        sess["session_id"], turn.turn_index, turn.text[:500],
                        gap.suggested_skill, gap.reasoning, gap.judgment_model, now,
                    ),
                )
                conn.commit()
                found += 1
    finally:
        conn.close()
    return found
