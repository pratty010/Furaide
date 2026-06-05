import json
import re
from datetime import datetime, timezone
from pathlib import Path
from mekiki import db, events, transcript
from mekiki.paths import events_dir, claude_projects_root

_CMD_NAME_RE = re.compile(r"<command-name>/?([^<]+)</command-name>")


def _detect_trigger(turns: list, inv_turn_index: int, skill: str) -> str:
    """Return 'user-typed' if a matching <command-name> tag precedes the invocation.

    Compares the parsed command name to the skill name (strips leading / and plugin: prefix).
    """
    for t in reversed(turns):
        if t.turn_index >= inv_turn_index:
            continue
        if t.role != "user":
            continue
        if t.raw.get("toolUseResult") or t.raw.get("sourceToolAssistantUUID"):
            continue
        m = _CMD_NAME_RE.search(t.text)
        if m:
            cmd = m.group(1).lower().lstrip("/")
            # strip plugin: prefix (e.g. "codex:rescue" → "rescue")
            if ":" in cmd:
                cmd = cmd.split(":", 1)[1]
            skill_norm = skill.lower().lstrip("/")
            if ":" in skill_norm:
                skill_norm = skill_norm.split(":", 1)[1]
            if cmd == skill_norm:
                return "user-typed"
        # Stop at the first non-tool-result user turn before the invocation
        return "model"
    return "model"


def _populate_skills_for_session(conn, session_id: str, jpath: Path) -> None:
    for s in transcript.extract_available_skills(jpath):
        conn.execute(
            "INSERT OR REPLACE INTO available_skills_at_session"
            "(session_id, skill_name, skill_description) VALUES(?, ?, ?)",
            (session_id, s.name, s.description),
        )


def run_transcript_scan(projects_root: Path | None = None) -> dict:
    """Primary ingest: scan ~/.claude/projects/ JSONL files as source of truth.

    Uses byte checkpoints in source_files to skip already-processed content.
    Derives used_downstream from native attributionSkill records (no LLM needed).
    Upserts update ALL derived columns so re-ingest repairs stale rows.
    """
    if projects_root is None:
        projects_root = claude_projects_root()

    db.init()
    conn = db.connect()
    counts = {"sessions": 0, "invocations": 0}

    try:
        if not projects_root.exists():
            return counts

        for slug_dir in sorted(projects_root.iterdir()):
            if not slug_dir.is_dir():
                continue
            for jpath in sorted(slug_dir.glob("*.jsonl")):
                size = jpath.stat().st_size
                offset = events._checkpoint_for(str(jpath))
                if offset >= size:
                    continue

                meta = transcript.extract_session_meta(jpath)
                conn.execute(
                    "INSERT INTO sessions(session_id, platform, cwd, model, source, "
                    "started_at, last_seen_at, transcript_path, ended_cleanly) "
                    "VALUES(?, 'claude-code', ?, ?, 'transcript', ?, ?, ?, ?) "
                    "ON CONFLICT(session_id) DO UPDATE SET "
                    "cwd=excluded.cwd, "
                    "model=excluded.model, "
                    "started_at=excluded.started_at, "
                    "last_seen_at=excluded.last_seen_at, "
                    "transcript_path=excluded.transcript_path, "
                    "ended_cleanly=excluded.ended_cleanly",
                    (
                        meta.session_id, meta.cwd, meta.model,
                        meta.started_at, meta.started_at,
                        str(jpath), 1 if meta.ended_cleanly else 0,
                    ),
                )
                counts["sessions"] += 1

                invocations = list(transcript.iter_skill_invocations(jpath))
                turns = list(transcript.iter_turns(jpath))
                downstream = transcript.derive_downstream_used(invocations, turns)

                for inv in invocations:
                    trigger = _detect_trigger(turns, inv.turn_index, inv.skill)
                    used_dn = 1 if downstream.get(inv.tool_use_id) else 0
                    conn.execute(
                        "INSERT INTO skill_invocations"
                        "(session_id, ts, skill, args, tool_use_id, turn_index, trigger, used_downstream) "
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
                        "ON CONFLICT(tool_use_id) DO UPDATE SET "
                        "session_id=excluded.session_id, "
                        "ts=excluded.ts, "
                        "skill=excluded.skill, "
                        "args=excluded.args, "
                        "turn_index=excluded.turn_index, "
                        "trigger=excluded.trigger, "
                        "used_downstream=excluded.used_downstream",
                        (
                            meta.session_id, inv.ts, inv.skill, inv.args,
                            inv.tool_use_id, inv.turn_index, trigger, used_dn,
                        ),
                    )
                    counts["invocations"] += 1

                _populate_skills_for_session(conn, meta.session_id, jpath)
                conn.commit()
                events.checkpoint(str(jpath), size)

    finally:
        conn.close()

    return counts


def run_hooks(platform: str = "claude-code") -> dict:
    """Secondary ingest: overlay effort_level from hook events.

    Reads only session.start and skill.user_typed events.
    Inserts sessions if missing; updates effort_level from the latest user_typed event.
    """
    db.init()
    conn = db.connect()
    counts = {"events": 0, "sessions": 0, "effort_updates": 0}
    bytes_at_seen: dict[str, int] = {}

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
                    bytes_at_seen[str(f)] = fh.tell()
                    try:
                        ev = json.loads(line.decode("utf-8").strip())
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue
                    counts["events"] += 1
                    et = ev.get("event")

                    if et == "session.start":
                        conn.execute(
                            "INSERT INTO sessions(session_id, platform, cwd, model, source, "
                            "started_at, last_seen_at, transcript_path) "
                            "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
                            "ON CONFLICT(session_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
                            (
                                ev["session_id"], ev.get("platform", "claude-code"),
                                ev.get("cwd"), ev.get("model"), ev.get("source"),
                                ev["ts"], ev["ts"], ev.get("transcript_path"),
                            ),
                        )
                        counts["sessions"] += 1

                    elif et == "skill.user_typed":
                        effort = ev.get("effort_level") or ""
                        if effort:
                            conn.execute(
                                "UPDATE sessions SET effort_level=? WHERE session_id=?",
                                (effort, ev["session_id"]),
                            )
                            counts["effort_updates"] += 1

            if str(f) in bytes_at_seen:
                conn.commit()
                events.checkpoint(str(f), bytes_at_seen[str(f)])

    finally:
        conn.close()

    return counts


def run(platform: str = "claude-code") -> dict:
    """Default ingest: transcript scan + hook overlay."""
    scan = run_transcript_scan()
    hooks = run_hooks(platform)
    hook_events = hooks.get("events", 0)
    return {
        **scan,
        "sessions": scan.get("sessions", 0) + hooks.get("sessions", 0),
        "hook_events": hook_events,
        "events": hook_events,  # backward-compat alias
        "effort_updates": hooks.get("effort_updates", 0),
    }
