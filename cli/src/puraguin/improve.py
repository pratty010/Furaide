# cli/src/puraguin/improve.py
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from puraguin import db, config
from puraguin.paths import evidence_dir

class InsufficientSampleError(Exception):
    pass

_TEMPLATE = """# Evidence pack — `{skill}` ({date})

## Summary
- Total judged invocations: {total}
- Positive: {positive} | Negative: {negative} | Neutral: {neutral} | None: {none_count}
- Load failures: {load_failures}
- Top user-reaction phrases (positive): {top_pos}
- Top user-reaction phrases (negative): {top_neg}

## Current `SKILL.md` description
{current_description}

## Positive exemplars (up to {n_pos_show})
{positive_block}

## Negative exemplars (up to {n_neg_show})
{negative_block}

## Gap findings — prompts where this skill *should* have fired but didn't (up to {n_gap_show})
{gap_block}

## Hand-off instructions
Pass this evidence pack to `Skill(skill-creator)` (relevant parts) or `Skill(writing-skills)` to revise the SKILL.md description. After applying or rejecting the rewrite, run:

```
puraguin improve --mark {skill} applied
puraguin improve --mark {skill} rejected
```
"""

def _exemplar_block(rows: list) -> str:
    if not rows:
        return "_(none)_"
    parts = []
    for r in rows:
        parts.append(
            f"- session `{r['session_id']}` turn {r['turn_index']}\n"
            f"  - reaction: {r['user_reaction']} — _{r['user_reaction_quote'] or ''}_\n"
            f"  - notes: {r['notes'] or ''}"
        )
    return "\n".join(parts)

def _gap_block(rows: list) -> str:
    if not rows:
        return "_(none)_"
    parts = []
    for r in rows:
        parts.append(
            f"- session `{r['session_id']}` turn {r['turn_index']}: \"{r['prompt_excerpt'][:200]}...\"\n"
            f"  - reasoning: {r['reasoning']}"
        )
    return "\n".join(parts)

def _current_description(skill: str) -> str:
    candidates = [
        Path.home() / ".claude" / "skills" / skill / "SKILL.md",
        Path.cwd() / ".claude" / "skills" / skill / "SKILL.md",
    ]
    for p in candidates:
        if p.exists():
            return p.read_text()[:2000]
    return "_(SKILL.md not found locally; pass current description manually)_"

def build_evidence_pack(skill: str) -> Path:
    cfg = config.load().improve
    db.init()
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT si.id, si.session_id, si.turn_index, si.load_success, "
            "  j.user_reaction, j.user_reaction_quote, j.notes "
            "FROM skill_invocations si "
            "LEFT JOIN invocation_judgments j ON j.invocation_id = si.id "
            "WHERE si.skill = ? ORDER BY si.ts DESC",
            (skill,),
        ).fetchall()
        judged = sum(1 for r in rows if r["user_reaction"] is not None)
        if judged < cfg.min_sample_size:
            raise InsufficientSampleError(
                f"skill '{skill}' has {judged} judged invocations; need >= {cfg.min_sample_size}"
            )
        positives = [r for r in rows if r["user_reaction"] == "positive"]
        negatives = [r for r in rows if r["user_reaction"] == "negative"]
        neutrals  = [r for r in rows if r["user_reaction"] == "neutral"]
        nones     = [r for r in rows if r["user_reaction"] in (None, "none")]
        load_failures = sum(1 for r in rows if r["load_success"] == 0)
        top_pos = Counter(r["user_reaction_quote"] for r in positives if r["user_reaction_quote"]).most_common(3)
        top_neg = Counter(r["user_reaction_quote"] for r in negatives if r["user_reaction_quote"]).most_common(3)
        gap_rows = conn.execute(
            "SELECT session_id, turn_index, prompt_excerpt, reasoning FROM gap_findings "
            "WHERE suggested_skill = ? ORDER BY judged_at DESC LIMIT 10",
            (skill,),
        ).fetchall()
        body = _TEMPLATE.format(
            skill=skill,
            date=datetime.now(timezone.utc).date().isoformat(),
            total=len(rows),
            positive=len(positives), negative=len(negatives), neutral=len(neutrals), none_count=len(nones),
            load_failures=load_failures,
            top_pos=", ".join(f'"{q}"x{c}' for q, c in top_pos) or "_(none)_",
            top_neg=", ".join(f'"{q}"x{c}' for q, c in top_neg) or "_(none)_",
            current_description=_current_description(skill),
            n_pos_show=min(5, len(positives)), positive_block=_exemplar_block(positives[:5]),
            n_neg_show=min(5, len(negatives)), negative_block=_exemplar_block(negatives[:5]),
            n_gap_show=len(gap_rows), gap_block=_gap_block(gap_rows),
        )
        evidence_dir().mkdir(parents=True, exist_ok=True)
        out_path = evidence_dir() / f"{skill}-{datetime.now(timezone.utc).date().isoformat()}.md"
        out_path.write_text(body)
        now = datetime.now(timezone.utc).isoformat()
        ids_json = json.dumps([r["id"] for r in rows])
        conn.execute(
            "INSERT INTO skill_improvements(skill, suggested_at, evidence_path, "
            "evidence_invocation_ids, status, status_updated_at) "
            "VALUES(?, ?, ?, ?, 'evidence_ready', ?)",
            (skill, now, str(out_path), ids_json, now),
        )
        conn.commit()
        return out_path
    finally:
        conn.close()

def mark_status(skill: str, status: str) -> None:
    assert status in ("applied", "rejected"), status
    db.init()
    conn = db.connect()
    try:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE skill_improvements SET status=?, status_updated_at=? "
            "WHERE id = (SELECT id FROM skill_improvements WHERE skill=? ORDER BY id DESC LIMIT 1)",
            (status, now, skill),
        )
        conn.commit()
    finally:
        conn.close()
