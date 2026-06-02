# cli/src/satori/aggregate.py
from datetime import datetime, timezone, timedelta
from satori import db

WINDOWS = {"all": None, "30d": 30, "7d": 7}

def _window_clause(window_days: int | None) -> tuple[str, tuple]:
    if window_days is None:
        return "", ()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
    return " AND si.ts >= ?", (cutoff,)

def run() -> dict:
    db.init()
    conn = db.connect()
    counts = {}
    try:
        for window_name, window_days in WINDOWS.items():
            clause, params = _window_clause(window_days)
            rows = conn.execute(
                "SELECT si.skill AS skill, "
                "  COUNT(*) AS invocations, "
                "  SUM(CASE WHEN j.user_reaction='positive' THEN 1 ELSE 0 END) AS positive, "
                "  SUM(CASE WHEN j.user_reaction='negative' THEN 1 ELSE 0 END) AS negative, "
                "  SUM(CASE WHEN j.user_reaction='neutral'  THEN 1 ELSE 0 END) AS neutral, "
                "  SUM(CASE WHEN j.user_reaction='none' OR j.user_reaction IS NULL THEN 1 ELSE 0 END) AS none_reaction, "
                "  SUM(CASE WHEN si.load_success=0 THEN 1 ELSE 0 END) AS load_failures, "
                "  SUM(CASE WHEN si.trigger='user-typed' THEN 1 ELSE 0 END) AS user_typed, "
                "  SUM(CASE WHEN si.trigger='model' THEN 1 ELSE 0 END) AS model_triggered "
                "FROM skill_invocations si "
                "LEFT JOIN invocation_judgments j ON j.invocation_id = si.id "
                "WHERE 1=1" + clause + " "
                "GROUP BY si.skill",
                params,
            ).fetchall()
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("DELETE FROM skill_stats WHERE window = ?", (window_name,))
            for r in rows:
                conn.execute(
                    "INSERT INTO skill_stats(skill, window, invocations, positive, negative, neutral, "
                    "none_reaction, load_failures, user_typed, model_triggered, computed_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (r["skill"], window_name, r["invocations"], r["positive"], r["negative"],
                     r["neutral"], r["none_reaction"], r["load_failures"],
                     r["user_typed"], r["model_triggered"], now),
                )
            counts[window_name] = len(rows)
        conn.commit()
    finally:
        conn.close()
    return counts
