import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

COMPACT_MARKER = "This session is being continued from a previous conversation"

@dataclass
class Turn:
    turn_index: int
    uuid: str
    parent_uuid: Optional[str]
    role: str
    timestamp: str
    text: str
    raw: dict

@dataclass
class SkillInvocation:
    turn_index: int
    tool_use_id: str
    skill: str
    args: str
    ts: str = ""

@dataclass
class AvailableSkill:
    name: str
    description: str

@dataclass
class SessionMeta:
    session_id: str
    cwd: Optional[str]
    model: Optional[str]
    started_at: Optional[str]
    ended_cleanly: bool

def _flatten_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, dict):
                if c.get("type") == "text":
                    parts.append(c.get("text", ""))
                elif c.get("type") == "tool_use":
                    parts.append(f"[tool_use:{c.get('name')}({json.dumps(c.get('input', {}))})]")
                elif c.get("type") == "tool_result":
                    parts.append(f"[tool_result:{c.get('tool_use_id', '')}]")
        return "\n".join(parts)
    return ""

def iter_turns(path: Path) -> Iterator[Turn]:
    idx = 0
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = obj.get("type")
            if t not in ("user", "assistant"):
                continue
            msg = obj.get("message", {})
            yield Turn(
                turn_index=idx,
                uuid=obj.get("uuid", ""),
                parent_uuid=obj.get("parentUuid"),
                role=t,
                timestamp=obj.get("timestamp", ""),
                text=_flatten_content(msg.get("content", "")),
                raw=obj,
            )
            idx += 1

def iter_skill_invocations(path: Path) -> Iterator[SkillInvocation]:
    for turn in iter_turns(path):
        if turn.role != "assistant":
            continue
        content = turn.raw.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for c in content:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "Skill":
                inp = c.get("input", {}) or {}
                yield SkillInvocation(
                    turn_index=turn.turn_index,
                    tool_use_id=c.get("id", ""),
                    skill=inp.get("skill") or inp.get("name") or "",
                    args=inp.get("args", "") if isinstance(inp.get("args", ""), str) else json.dumps(inp.get("args", "")),
                    ts=turn.timestamp,
                )

def extract_session_meta(path: Path) -> SessionMeta:
    """Extract session metadata. Prefers in-record sessionId over filename stem."""
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    model: Optional[str] = None
    started_at: Optional[str] = None
    ended_cleanly = False

    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if session_id is None:
                session_id = obj.get("sessionId")
            if cwd is None:
                cwd = obj.get("cwd")
            if model is None:
                model = obj.get("model") or (obj.get("message") or {}).get("model")
            if started_at is None and obj.get("timestamp"):
                started_at = obj["timestamp"]
            if obj.get("type") == "system" and obj.get("subtype") == "stop_hook_summary":
                ended_cleanly = True

    return SessionMeta(
        session_id=session_id or path.stem,
        cwd=cwd,
        model=model,
        started_at=started_at,
        ended_cleanly=ended_cleanly,
    )

def turn_bounded_window(turns: list[Turn], target_turn_index: int) -> list[Turn]:
    """Return all turns in the same conversation block as target_turn_index.

    A block is bounded by non-tool-result user messages (human messages).
    Tool-result records have toolUseResult=true or sourceToolAssistantUUID set.
    Returns from the preceding human message up to (not including) the next human message.
    """
    def _is_human_msg(t: Turn) -> bool:
        return (
            t.role == "user"
            and not t.raw.get("toolUseResult")
            and not t.raw.get("sourceToolAssistantUUID")
        )

    sorted_turns = sorted(turns, key=lambda t: t.turn_index)

    # Find start: last human message with turn_index <= target
    start_idx = 0
    found_human_before_target = False
    for i, t in enumerate(sorted_turns):
        if t.turn_index > target_turn_index:
            break
        if _is_human_msg(t):
            start_idx = i
            found_human_before_target = True

    if not found_human_before_target:
        for i, t in enumerate(sorted_turns):
            if t.turn_index == target_turn_index:
                start_idx = i
                break

    # Find end: first human message with turn_index > target (exclusive)
    end_idx = len(sorted_turns)
    for i in range(len(sorted_turns) - 1, -1, -1):
        t = sorted_turns[i]
        if t.turn_index <= target_turn_index:
            break
        if _is_human_msg(t):
            end_idx = i

    return sorted_turns[start_idx:end_idx]

def derive_downstream_used(
    invocations: list[SkillInvocation], turns: list[Turn]
) -> dict[str, bool]:
    """Return {tool_use_id: used_downstream} based on native attributionSkill records.

    used_downstream is True if any assistant turn with attributionSkill == invocation.skill
    appears after the invocation turn_index and before the next invocation of the same skill.
    """
    # Build per-skill sorted invocation turn indices for bounding
    skill_turn_indices: dict[str, list[int]] = defaultdict(list)
    for inv in invocations:
        skill_turn_indices[inv.skill].append(inv.turn_index)
    for k in skill_turn_indices:
        skill_turn_indices[k].sort()

    result: dict[str, bool] = {}
    for inv in invocations:
        # Find next invocation of same skill after this one (upper bound)
        same_skill_turns = skill_turn_indices[inv.skill]
        nxt = next((t for t in same_skill_turns if t > inv.turn_index), None)
        used = any(
            t.role == "assistant"
            and t.turn_index > inv.turn_index
            and (nxt is None or t.turn_index < nxt)
            and t.raw.get("attributionSkill") == inv.skill
            for t in turns
        )
        result[inv.tool_use_id] = used
    return result

def detect_compact_boundary(path: Path) -> Optional[int]:
    for turn in iter_turns(path):
        if turn.role == "user" and COMPACT_MARKER in turn.text:
            return turn.turn_index
    return None

def window_around(turns: list[Turn], target_index: int, before: int, after: int) -> list[Turn]:
    lo = max(0, target_index - before)
    hi = target_index + after + 1
    return [t for t in turns if lo <= t.turn_index < hi]

_SKILLS_REMINDER_RE = re.compile(
    r"The following skills are available for use with the Skill tool:\s*(.+?)(?:</system-reminder>|$)",
    re.DOTALL,
)
_SKILL_LINE_RE = re.compile(r"^\s*-\s+([a-zA-Z0-9:_\-]+):\s*(.+?)\s*$")

def extract_available_skills(path: Path) -> list[AvailableSkill]:
    for turn in iter_turns(path):
        m = _SKILLS_REMINDER_RE.search(turn.text)
        if not m:
            continue
        block = m.group(1)
        out: list[AvailableSkill] = []
        for line in block.splitlines():
            lm = _SKILL_LINE_RE.match(line)
            if lm:
                out.append(AvailableSkill(name=lm.group(1), description=lm.group(2)))
        if out:
            return out
    return []
