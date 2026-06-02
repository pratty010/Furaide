# cli/src/satori/report/generate.py
from datetime import datetime, timezone
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape
from satori import db
from satori.paths import reports_dir

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)),
                   autoescape=select_autoescape(["html"]))

def _render(template_name: str, **ctx) -> str:
    tmpl = _env.get_template(template_name)
    ctx.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
    return tmpl.render(**ctx)

def _out_path(name: str) -> Path:
    p = reports_dir()
    p.mkdir(parents=True, exist_ok=True)
    return p / name

def overview() -> Path:
    conn = db.connect()
    try:
        by_count = conn.execute(
            "SELECT * FROM skill_stats WHERE window='all' ORDER BY invocations DESC LIMIT 50"
        ).fetchall()
        gaps = conn.execute(
            "SELECT session_id, turn_index, prompt_excerpt, suggested_skill, reasoning "
            "FROM gap_findings ORDER BY judged_at DESC LIMIT 30"
        ).fetchall()
    finally:
        conn.close()
    html = _render("overview.html", title="Skill usage overview",
                   by_count=[dict(r) for r in by_count],
                   gaps=[dict(r) for r in gaps])
    p = _out_path("overview.html")
    p.write_text(html)
    return p

def skill_detail(skill: str, window: str = "all") -> Path:
    conn = db.connect()
    try:
        stats = conn.execute(
            "SELECT * FROM skill_stats WHERE skill=? AND window=?",
            (skill, window),
        ).fetchone()
        if stats is None:
            stats_dict = {
                "skill": skill, "window": window,
                "invocations": 0, "positive": 0, "negative": 0, "neutral": 0,
                "none_reaction": 0, "load_failures": 0, "user_typed": 0, "model_triggered": 0,
            }
        else:
            stats_dict = dict(stats)
        positive_examples = conn.execute(
            "SELECT si.session_id, si.turn_index, j.user_reaction_quote, j.notes "
            "FROM skill_invocations si JOIN invocation_judgments j ON j.invocation_id = si.id "
            "WHERE si.skill=? AND j.user_reaction='positive' ORDER BY si.ts DESC LIMIT 10",
            (skill,),
        ).fetchall()
        negative_examples = conn.execute(
            "SELECT si.session_id, si.turn_index, j.user_reaction_quote, j.notes "
            "FROM skill_invocations si JOIN invocation_judgments j ON j.invocation_id = si.id "
            "WHERE si.skill=? AND j.user_reaction='negative' ORDER BY si.ts DESC LIMIT 10",
            (skill,),
        ).fetchall()
        gaps = conn.execute(
            "SELECT session_id, turn_index, prompt_excerpt, reasoning FROM gap_findings "
            "WHERE suggested_skill=? ORDER BY judged_at DESC LIMIT 20",
            (skill,),
        ).fetchall()
        latest_improvement = conn.execute(
            "SELECT * FROM skill_improvements WHERE skill=? ORDER BY id DESC LIMIT 1",
            (skill,),
        ).fetchone()
    finally:
        conn.close()
    html = _render("skill_detail.html",
                   title=f"Skill: {skill}",
                   window=window,
                   stats=stats_dict,
                   positive_examples=[dict(r) for r in positive_examples],
                   negative_examples=[dict(r) for r in negative_examples],
                   gaps=[dict(r) for r in gaps],
                   latest_improvement=dict(latest_improvement) if latest_improvement else None)
    p = _out_path(f"skill-{skill}.html")
    p.write_text(html)
    return p
