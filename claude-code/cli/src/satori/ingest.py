import json
from datetime import datetime, timezone
from pathlib import Path
from satori import db, events, transcript
from satori.paths import events_dir

def _upsert_session(conn, ev: dict) -> None:
    conn.execute(
        "INSERT INTO sessions(session_id, platform, cwd, model, source, started_at, last_seen_at, transcript_path) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(session_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
        (
            ev["session_id"], ev.get("platform", "claude-code"),
            ev.get("cwd"), ev.get("model"), ev.get("source"),
            ev["ts"], ev["ts"], ev.get("transcript_path"),
        ),
    )

def _upsert_invocation(conn, ev: dict, turn_index: int | None) -> None:
    conn.execute(
        "INSERT INTO skill_invocations(session_id, ts, skill, args, tool_use_id, turn_index, trigger) "
        "VALUES(?, ?, ?, ?, ?, ?, 'model') "
        "ON CONFLICT(tool_use_id) DO UPDATE SET turn_index=COALESCE(excluded.turn_index, skill_invocations.turn_index)",
        (
            ev["session_id"], ev["ts"], ev.get("skill", ""), ev.get("args", ""),
            ev.get("tool_use_id"), turn_index,
        ),
    )

def _apply_loaded(conn, ev: dict) -> None:
    duration_ms = int(round(float(ev.get("run_time_seconds", 0)) * 1000))
    success = 1 if int(ev.get("exit_code", 0)) == 0 else 0
    conn.execute(
        "UPDATE skill_invocations SET load_success=?, load_duration_ms=? WHERE tool_use_id=?",
        (success, duration_ms, ev.get("tool_use_id")),
    )

def _apply_failed(conn, ev: dict) -> None:
    conn.execute(
        "UPDATE skill_invocations SET load_success=0, load_error=? WHERE tool_use_id=?",
        (ev.get("stderr", ""), ev.get("tool_use_id")),
    )


def _populate_skills_for_session(conn, session_id: str, transcript_path: str) -> None:
    p = Path(transcript_path)
    if not p.exists():
        return
    for s in transcript.extract_available_skills(p):
        conn.execute(
            "INSERT OR REPLACE INTO available_skills_at_session(session_id, skill_name, skill_description) "
            "VALUES(?, ?, ?)",
            (session_id, s.name, s.description),
        )

def _resolve_turn_index(transcript_path: str, tool_use_id: str) -> int | None:
    p = Path(transcript_path)
    if not p.exists():
        return None
    for inv in transcript.iter_skill_invocations(p):
        if inv.tool_use_id == tool_use_id:
            return inv.turn_index
    return None

def run(platform: str = "claude-code") -> dict:
    db.init()
    conn = db.connect()
    counts = {"events": 0, "sessions": 0, "invocations": 0, "user_typed_marks": 0, "load_results": 0}
    bytes_at_seen: dict[str, int] = {}
    # Accumulate user_typed signals across all files; matched in a post-pass after all files processed.
    pending_signals: list[tuple[str, str, str]] = []  # (session_id, skill, ts)
    try:
        for f in sorted(events_dir(platform).glob("*.jsonl")):
            offset = events._checkpoint_for(str(f))
            if offset >= f.stat().st_size:
                continue
            with f.open("rb") as fh:
                fh.seek(offset)
                while True:
                    line = fh.readline()
                    if not line:
                        break
                    bytes_at_seen[str(f)] = fh.tell()  # always advance checkpoint past this line
                    try:
                        ev = json.loads(line.decode("utf-8").strip())
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue
                    counts["events"] += 1
                    et = ev.get("event")
                    if et == "session.start":
                        _upsert_session(conn, ev)
                        counts["sessions"] += 1
                        if ev.get("transcript_path"):
                            _populate_skills_for_session(conn, ev["session_id"], ev["transcript_path"])
                    elif et == "skill.user_typed":
                        pending_signals.append((ev["session_id"], ev.get("skill", ""), ev["ts"]))
                        counts["user_typed_marks"] += 1
                    elif et == "skill.invoke":
                        idx = _resolve_turn_index(ev.get("transcript_path", ""), ev.get("tool_use_id", ""))
                        _upsert_invocation(conn, ev, idx)
                        counts["invocations"] += 1
                    elif et == "skill.loaded":
                        _apply_loaded(conn, ev)
                        counts["load_results"] += 1
                    elif et == "skill.load_failed":
                        _apply_failed(conn, ev)
                        counts["load_results"] += 1
            if str(f) in bytes_at_seen:
                conn.commit()
                events.checkpoint(str(f), bytes_at_seen[str(f)])
        # Post-pass: match user_typed signals to their nearest invocation within 10 seconds.
        for sid, skill, ts in pending_signals:
            conn.execute(
                "UPDATE skill_invocations SET trigger='user-typed' WHERE id = ("
                "  SELECT id FROM skill_invocations "
                "  WHERE trigger='model' AND session_id=? AND skill=? "
                "  AND ABS(julianday(ts) - julianday(?)) * 86400 < 10 "
                "  ORDER BY ABS(julianday(ts) - julianday(?)) LIMIT 1)",
                (sid, skill, ts, ts),
            )
        conn.commit()
    finally:
        conn.close()
    return counts
