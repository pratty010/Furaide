from pathlib import Path
from mekiki import db, transcript
from mekiki.judge.interface import InvocationContext


def build(invocation_id: int) -> InvocationContext:
    """Build InvocationContext for a skill invocation using turn-bounded windows.

    Applies the filter-IDs-first discipline: fetch only the row we need from DB,
    then read transcript text only for that invocation's block.
    """
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
        if row["turn_index"] is None:
            raise KeyError(f"invocation {invocation_id} has no turn_index")
        turn_index = row["turn_index"]
        turns = (
            list(transcript.iter_turns(Path(transcript_path)))
            if transcript_path
            else []
        )

        window = transcript.turn_bounded_window(turns, turn_index)

        before_texts = [
            f"[{t.role}] {t.text}"
            for t in window
            if t.turn_index < turn_index
        ]
        after_texts = [
            f"[{t.role}] {t.text}"
            for t in window
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
