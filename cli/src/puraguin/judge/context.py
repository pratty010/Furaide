from pathlib import Path
from puraguin import db, transcript
from puraguin.judge.interface import InvocationContext

def build(invocation_id: int, before: int = 10, after: int = 10) -> InvocationContext:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT si.*, s.transcript_path FROM skill_invocations si "
            "JOIN sessions s ON s.session_id = si.session_id "
            "WHERE si.id = ?",
            (invocation_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"invocation {invocation_id} not found")
        transcript_path = row["transcript_path"]
        turn_index = row["turn_index"] or 0
        turns = list(transcript.iter_turns(Path(transcript_path))) if transcript_path else []
        before_texts = [
            f"[{t.role}] {t.text}"
            for t in transcript.window_around(turns, turn_index, before=before, after=0)
            if t.turn_index < turn_index
        ]
        after_texts = [
            f"[{t.role}] {t.text}"
            for t in transcript.window_around(turns, turn_index, before=0, after=after)
            if t.turn_index > turn_index
        ]
        return InvocationContext(
            invocation_id=row["id"],
            session_id=row["session_id"],
            skill=row["skill"],
            args=row["args"] or "",
            trigger=row["trigger"],
            turn_index=turn_index,
            context_before=before_texts,
            context_after=after_texts,
        )
    finally:
        conn.close()
