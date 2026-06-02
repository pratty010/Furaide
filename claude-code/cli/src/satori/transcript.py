import json
import re
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

@dataclass
class AvailableSkill:
    name: str
    description: str

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
                )

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
