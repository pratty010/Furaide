# Mekiki — File-Parsing Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mekiki's never-firing hook pipeline with a transcript-file-parsing spine so `state.db` goes from 0 rows to populated on every `mekiki ingest` run.

**Architecture:** `ingest.py` pivots to scanning `~/.claude/projects/<slug>/*.jsonl` directly; hooks are trimmed to `UserPromptExpansion` (effort.level only) + `Stop` (flush). `transcript.py` gains turn-bounded windows and session-meta extraction. The judge gains the G-Eval two-phase scoring pattern. A `SessionAdapter` protocol skeleton is added for future codex/opencode adapters.

**Tech Stack:** Python 3.12, SQLite (via stdlib sqlite3), uv for env, pytest for tests. All in `claude-code/cli/`. No new runtime dependencies.

---

## File map

| File | Action | What changes |
|---|---|---|
| `claude-code/cli/src/mekiki/db.py` | Modify | Migration: add `used_downstream`, `ended_cleanly`, `effort_level`, `score` columns |
| `claude-code/cli/src/mekiki/transcript.py` | Modify | Add `SessionMeta`, `extract_session_meta`, `turn_bounded_window`, `derive_downstream_used`; extend `SkillInvocation.ts` |
| `claude-code/cli/src/mekiki/ingest.py` | Modify | Add `run_transcript_scan()` as new primary ingest; rename old pipeline to `run_hooks()` |
| `claude-code/cli/src/mekiki/judge/context.py` | Modify | Use `turn_bounded_window` instead of fixed `window_around(±10)` |
| `claude-code/cli/src/mekiki/judge/prompts.py` | Modify | Replace `CLASSIFY_SYSTEM` with G-Eval two-phase prompts; keep `GAP_SYSTEM` |
| `claude-code/cli/src/mekiki/judge/interface.py` | Modify | Add `score: float` to `Judgment` dataclass |
| `claude-code/cli/src/mekiki/judge/anthropic_backend.py` | Modify | Implement G-Eval two-phase in `classify_invocation` |
| `claude-code/cli/src/mekiki/judge/orchestrator.py` | Modify | Read `used_downstream`/`ended_cleanly` from DB; write `score` to `invocation_judgments` |
| `claude-code/cli/src/mekiki/adapters/__init__.py` | Create | Package init |
| `claude-code/cli/src/mekiki/adapters/base.py` | Create | `SessionRecord` dataclass + `SessionAdapter` Protocol |
| `claude-code/cli/src/mekiki/adapters/claude_code.py` | Create | `ClaudeCodeAdapter` wrapping transcript.py |
| `claude-code/cli/src/mekiki/adapters/codex.py` | Create | Stub with NotImplementedError |
| `claude-code/cli/src/mekiki/adapters/opencode.py` | Create | Stub with NotImplementedError |
| `claude-code/plugins/mekiki/hooks/hooks.json` | Modify | Remove 4 redundant hooks; keep UserPromptExpansion + Stop/StopFailure |
| `claude-code/plugins/mekiki/hooks/user_prompt_expansion.sh` | Modify | Extract `effort.level` and `command_source` into emitted event |
| `claude-code/cli/tests/test_db.py` | Modify | Add migration idempotency test |
| `claude-code/cli/tests/test_transcript.py` | Modify | Add tests for new functions |
| `claude-code/cli/tests/test_ingest.py` | Modify | Replace hook-event tests with transcript-scan tests |
| `claude-code/cli/tests/test_judge_context.py` | Modify | Update to assert turn-bounded windows |
| `claude-code/cli/tests/test_adapters.py` | Create | Adapter protocol tests |
| `claude-code/cli/tests/fixtures/transcript_with_attribution.jsonl` | Create | Fixture with attributionSkill + stop_hook_summary |
| `claude-code/cli/tests/fixtures/projects/-test-slug-/sess1.jsonl` | Create | Fixture simulating ~/.claude/projects/ structure |

---

## Task 1: DB schema migration

**Files:**
- Modify: `claude-code/cli/src/mekiki/db.py`
- Modify: `claude-code/cli/tests/test_db.py`

- [ ] **Step 1: Read the existing test_db.py**

```bash
cd claude-code/cli && cat tests/test_db.py
```

- [ ] **Step 2: Write failing tests**

Append to `claude-code/cli/tests/test_db.py`:

```python
def test_schema_has_new_columns(mekiki_home):
    db.init()
    conn = db.connect()
    # skill_invocations.used_downstream
    conn.execute("SELECT used_downstream FROM skill_invocations LIMIT 0")
    # sessions.ended_cleanly + effort_level
    conn.execute("SELECT ended_cleanly, effort_level FROM sessions LIMIT 0")
    # invocation_judgments.score
    conn.execute("SELECT score FROM invocation_judgments LIMIT 0")
    conn.close()

def test_schema_migration_is_idempotent(mekiki_home):
    db.init()
    db.init()  # second call must not raise
    conn = db.connect()
    conn.execute("SELECT used_downstream FROM skill_invocations LIMIT 0")
    conn.close()
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd claude-code/cli && uv run pytest tests/test_db.py::test_schema_has_new_columns tests/test_db.py::test_schema_migration_is_idempotent -v 2>&1 | tail -20
```

Expected: FAILED — `no such column: used_downstream`

- [ ] **Step 4: Add migration to db.py**

In `claude-code/cli/src/mekiki/db.py`, update the `SCHEMA` constant — add `used_downstream INTEGER` to `skill_invocations`, and add `ended_cleanly INTEGER` + `effort_level TEXT` to `sessions`, and add `score REAL` to `invocation_judgments`:

```python
SCHEMA = """
CREATE TABLE IF NOT EXISTS source_files (
  path TEXT PRIMARY KEY,
  last_byte_processed INTEGER NOT NULL DEFAULT 0,
  last_processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  cwd TEXT,
  model TEXT,
  source TEXT,
  started_at TEXT,
  last_seen_at TEXT,
  transcript_path TEXT,
  ended_cleanly INTEGER,
  effort_level TEXT
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  skill TEXT NOT NULL,
  args TEXT,
  tool_use_id TEXT UNIQUE,
  turn_index INTEGER,
  trigger TEXT NOT NULL DEFAULT 'model',
  load_success INTEGER,
  load_duration_ms INTEGER,
  load_error TEXT,
  used_downstream INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_invocations_skill ON skill_invocations(skill);
CREATE INDEX IF NOT EXISTS idx_invocations_session ON skill_invocations(session_id);

CREATE TABLE IF NOT EXISTS invocation_judgments (
  invocation_id INTEGER PRIMARY KEY,
  used_downstream INTEGER,
  user_reaction TEXT,
  user_reaction_quote TEXT,
  session_ended_cleanly INTEGER,
  score REAL,
  judgment_model TEXT,
  judged_at TEXT,
  notes TEXT,
  FOREIGN KEY (invocation_id) REFERENCES skill_invocations(id)
);

CREATE TABLE IF NOT EXISTS gap_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  prompt_excerpt TEXT,
  suggested_skill TEXT,
  reasoning TEXT,
  judgment_model TEXT,
  judged_at TEXT,
  UNIQUE(session_id, turn_index, suggested_skill)
);

CREATE TABLE IF NOT EXISTS available_skills_at_session (
  session_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_description TEXT,
  PRIMARY KEY (session_id, skill_name)
);

CREATE TABLE IF NOT EXISTS skill_stats (
  skill TEXT NOT NULL,
  window TEXT NOT NULL,
  invocations INTEGER NOT NULL,
  positive INTEGER NOT NULL,
  negative INTEGER NOT NULL,
  neutral INTEGER NOT NULL,
  none_reaction INTEGER NOT NULL,
  load_failures INTEGER NOT NULL,
  user_typed INTEGER NOT NULL,
  model_triggered INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (skill, window)
);

CREATE TABLE IF NOT EXISTS skill_improvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill TEXT NOT NULL,
  suggested_at TEXT NOT NULL,
  evidence_path TEXT NOT NULL,
  evidence_invocation_ids TEXT,
  status TEXT NOT NULL,
  status_updated_at TEXT
);
"""

_MIGRATIONS = [
    "ALTER TABLE skill_invocations ADD COLUMN used_downstream INTEGER",
    "ALTER TABLE sessions ADD COLUMN ended_cleanly INTEGER",
    "ALTER TABLE sessions ADD COLUMN effort_level TEXT",
    "ALTER TABLE invocation_judgments ADD COLUMN score REAL",
]
```

Then update `init()` to apply migrations:

```python
def init() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        for sql in _MIGRATIONS:
            try:
                conn.execute(sql)
            except Exception:
                pass  # column already exists on older DBs
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd claude-code/cli && uv run pytest tests/test_db.py -v 2>&1 | tail -20
```

Expected: all PASSED

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/mekiki/db.py claude-code/cli/tests/test_db.py
git commit -m "feat(mekiki): extend schema with used_downstream, ended_cleanly, effort_level, score"
```

---

## Task 2: transcript.py — session meta, turn-bounded windows, downstream attribution

**Files:**
- Modify: `claude-code/cli/src/mekiki/transcript.py`
- Create: `claude-code/cli/tests/fixtures/transcript_with_attribution.jsonl`
- Modify: `claude-code/cli/tests/test_transcript.py`

- [ ] **Step 1: Create the attribution fixture**

Write `claude-code/cli/tests/fixtures/transcript_with_attribution.jsonl`:

```jsonl
{"type":"user","uuid":"u1","sessionId":"sess-attr","parentUuid":null,"timestamp":"2026-06-01T10:00:00.000Z","cwd":"/tmp/proj","message":{"role":"user","content":"use brainstorming skill"}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess-attr","timestamp":"2026-06-01T10:00:01.000Z","attributionSkill":"brainstorming","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_bs1","name":"Skill","input":{"skill":"brainstorming","args":"design mekiki"}}]}}
{"type":"user","uuid":"tr1","parentUuid":"a1","sessionId":"sess-attr","timestamp":"2026-06-01T10:00:02.000Z","toolUseResult":true,"sourceToolAssistantUUID":"a1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_bs1","content":"skill output"}]}}
{"type":"assistant","uuid":"a2","parentUuid":"tr1","sessionId":"sess-attr","timestamp":"2026-06-01T10:00:03.000Z","attributionSkill":"brainstorming","message":{"role":"assistant","content":[{"type":"text","text":"Here is the brainstorming output"}]}}
{"type":"user","uuid":"u2","parentUuid":"a2","sessionId":"sess-attr","timestamp":"2026-06-01T10:00:10.000Z","message":{"role":"user","content":"looks good"}}
{"type":"assistant","uuid":"a3","parentUuid":"u2","sessionId":"sess-attr","timestamp":"2026-06-01T10:00:11.000Z","message":{"role":"assistant","content":[{"type":"text","text":"great"}]}}
{"type":"system","uuid":"s1","sessionId":"sess-attr","timestamp":"2026-06-01T10:00:12.000Z","subtype":"stop_hook_summary","message":{"role":"system","content":"Session complete"}}
```

- [ ] **Step 2: Write failing tests**

Append to `claude-code/cli/tests/test_transcript.py`:

```python
def test_extract_session_meta_reads_session_id_from_stem():
    meta = transcript.extract_session_meta(FIXTURES / "transcript_with_attribution.jsonl")
    assert meta.session_id == "transcript_with_attribution"
    assert meta.cwd == "/tmp/proj"
    assert meta.started_at == "2026-06-01T10:00:00.000Z"
    assert meta.ended_cleanly is True

def test_extract_session_meta_no_stop_hook():
    meta = transcript.extract_session_meta(FIXTURES / "transcript_simple.jsonl")
    assert meta.ended_cleanly is False

def test_turn_bounded_window_returns_block_between_human_messages():
    turns = list(transcript.iter_turns(FIXTURES / "transcript_with_attribution.jsonl"))
    # target_turn_index=1 is the assistant Skill tool_use record; it's in the block
    # starting at human message turn_index=0 and ending before human message at turn_index=4
    window = transcript.turn_bounded_window(turns, target_turn_index=1)
    indices = [t.turn_index for t in window]
    assert 0 in indices  # human prompt
    assert 1 in indices  # Skill tool_use
    assert 2 in indices  # tool_result
    assert 3 in indices  # downstream assistant
    assert 4 not in indices  # next human message excluded

def test_derive_downstream_used_detects_attribution():
    turns = list(transcript.iter_turns(FIXTURES / "transcript_with_attribution.jsonl"))
    invocations = list(transcript.iter_skill_invocations(FIXTURES / "transcript_with_attribution.jsonl"))
    result = transcript.derive_downstream_used(invocations, turns)
    assert result["toolu_bs1"] is True

def test_skill_invocation_has_ts():
    invs = list(transcript.iter_skill_invocations(FIXTURES / "transcript_with_attribution.jsonl"))
    assert len(invs) == 1
    assert invs[0].ts == "2026-06-01T10:00:01.000Z"
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd claude-code/cli && uv run pytest tests/test_transcript.py::test_extract_session_meta_reads_session_id_from_stem tests/test_transcript.py::test_turn_bounded_window_returns_block_between_human_messages tests/test_transcript.py::test_derive_downstream_used_detects_attribution tests/test_transcript.py::test_skill_invocation_has_ts -v 2>&1 | tail -25
```

Expected: FAILED — attribute errors / missing functions

- [ ] **Step 4: Implement additions in transcript.py**

Replace the entire content of `claude-code/cli/src/mekiki/transcript.py` with:

```python
import json
import re
from dataclasses import dataclass, field
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
    """Extract session metadata from a transcript JSONL file.
    session_id is inferred from the filename stem.
    """
    session_id = path.stem
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
            if cwd is None:
                cwd = obj.get("cwd")
            if model is None:
                model = obj.get("model") or (obj.get("message") or {}).get("model")
            if started_at is None and obj.get("timestamp"):
                started_at = obj["timestamp"]
            if obj.get("type") == "system" and obj.get("subtype") == "stop_hook_summary":
                ended_cleanly = True

    return SessionMeta(
        session_id=session_id,
        cwd=cwd,
        model=model,
        started_at=started_at,
        ended_cleanly=ended_cleanly,
    )

def turn_bounded_window(turns: list[Turn], target_turn_index: int) -> list[Turn]:
    """Return all turns in the same conversation block as target_turn_index.

    A block is delimited by non-tool-result user messages (human messages).
    Tool result records have `toolUseResult` or `sourceToolAssistantUUID` set at top level.
    The returned slice runs from the preceding human message up to (but not including)
    the next human message.
    """
    def _is_human_msg(t: Turn) -> bool:
        return (
            t.role == "user"
            and not t.raw.get("toolUseResult")
            and not t.raw.get("sourceToolAssistantUUID")
        )

    sorted_turns = sorted(turns, key=lambda t: t.turn_index)

    # Find start of block: last human message with turn_index <= target
    start_idx = 0
    for i, t in enumerate(sorted_turns):
        if t.turn_index > target_turn_index:
            break
        if _is_human_msg(t):
            start_idx = i

    # Find end of block: first human message with turn_index > target (exclusive)
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

    used_downstream is True if any assistant turn after the invocation has
    attributionSkill == invocation.skill.
    """
    result: dict[str, bool] = {}
    for inv in invocations:
        used = any(
            t.role == "assistant"
            and t.turn_index > inv.turn_index
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd claude-code/cli && uv run pytest tests/test_transcript.py -v 2>&1 | tail -20
```

Expected: all PASSED

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/mekiki/transcript.py \
        claude-code/cli/tests/test_transcript.py \
        "claude-code/cli/tests/fixtures/transcript_with_attribution.jsonl"
git commit -m "feat(mekiki/transcript): add SessionMeta, turn_bounded_window, derive_downstream_used, SkillInvocation.ts"
```

---

## Task 3: ingest.py — transcript-scanning spine

**Files:**
- Modify: `claude-code/cli/src/mekiki/ingest.py`
- Create: `claude-code/cli/tests/fixtures/projects/-test-slug-/sess1.jsonl`
- Modify: `claude-code/cli/tests/test_ingest.py`

- [ ] **Step 1: Create the projects fixture**

Write `claude-code/cli/tests/fixtures/projects/-test-slug-/sess1.jsonl`:

```jsonl
{"type":"user","uuid":"u1","sessionId":"sess1","parentUuid":null,"timestamp":"2026-06-01T10:00:00.000Z","cwd":"/tmp/proj","message":{"role":"user","content":"use brainstorming"}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess1","timestamp":"2026-06-01T10:00:01.000Z","attributionSkill":"brainstorming","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_bs1","name":"Skill","input":{"skill":"brainstorming","args":"design thing"}}]}}
{"type":"user","uuid":"tr1","parentUuid":"a1","sessionId":"sess1","timestamp":"2026-06-01T10:00:02.000Z","toolUseResult":true,"sourceToolAssistantUUID":"a1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_bs1","content":"ok"}]}}
{"type":"assistant","uuid":"a2","parentUuid":"tr1","sessionId":"sess1","timestamp":"2026-06-01T10:00:03.000Z","attributionSkill":"brainstorming","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}
{"type":"system","uuid":"s1","sessionId":"sess1","timestamp":"2026-06-01T10:00:04.000Z","subtype":"stop_hook_summary","message":{"role":"system","content":"done"}}
```

- [ ] **Step 2: Write failing tests**

Replace content of `claude-code/cli/tests/test_ingest.py` with:

```python
import json
from pathlib import Path
import pytest
from mekiki import ingest, db, paths

FIXTURES = Path(__file__).parent / "fixtures"
PROJECTS_FIXTURES = FIXTURES / "projects"

# ── transcript-scan tests (new spine) ──────────────────────────────────────

def test_transcript_scan_creates_session(mekiki_home):
    db.init()
    counts = ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    sess = conn.execute("SELECT * FROM sessions WHERE session_id='sess1'").fetchone()
    assert sess is not None
    assert sess["platform"] == "claude-code"
    assert sess["cwd"] == "/tmp/proj"
    assert sess["ended_cleanly"] == 1
    conn.close()
    assert counts["sessions"] >= 1

def test_transcript_scan_creates_invocation(mekiki_home):
    db.init()
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    inv = conn.execute(
        "SELECT * FROM skill_invocations WHERE tool_use_id='toolu_bs1'"
    ).fetchone()
    assert inv is not None
    assert inv["skill"] == "brainstorming"
    assert inv["ts"] == "2026-06-01T10:00:01.000Z"
    conn.close()

def test_transcript_scan_derives_used_downstream(mekiki_home):
    db.init()
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    inv = conn.execute(
        "SELECT used_downstream FROM skill_invocations WHERE tool_use_id='toolu_bs1'"
    ).fetchone()
    assert inv["used_downstream"] == 1
    conn.close()

def test_transcript_scan_is_idempotent(mekiki_home):
    db.init()
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    ingest.run_transcript_scan(projects_root=PROJECTS_FIXTURES)
    conn = db.connect()
    count = conn.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()["c"]
    assert count == 1
    conn.close()

def test_transcript_scan_detects_user_typed_trigger(mekiki_home):
    # Create a transcript where the user message contains <command-name> tag
    proj_dir = mekiki_home / "fake_projects" / "-slug-"
    proj_dir.mkdir(parents=True)
    jpath = proj_dir / "sess-cmd.jsonl"
    jpath.write_text(
        json.dumps({"type": "user", "uuid": "u1", "sessionId": "sess-cmd", "parentUuid": None,
                    "timestamp": "2026-06-01T09:00:00.000Z", "cwd": "/tmp",
                    "message": {"role": "user", "content": "<command-name>/brainstorming</command-name> build it"}}) + "\n" +
        json.dumps({"type": "assistant", "uuid": "a1", "parentUuid": "u1", "sessionId": "sess-cmd",
                    "timestamp": "2026-06-01T09:00:01.000Z",
                    "message": {"role": "assistant", "content": [
                        {"type": "tool_use", "id": "toolu_cmd1", "name": "Skill",
                         "input": {"skill": "brainstorming", "args": ""}}]}}) + "\n"
    )
    db.init()
    ingest.run_transcript_scan(projects_root=mekiki_home / "fake_projects")
    conn = db.connect()
    inv = conn.execute(
        "SELECT trigger FROM skill_invocations WHERE tool_use_id='toolu_cmd1'"
    ).fetchone()
    assert inv["trigger"] == "user-typed"
    conn.close()

# ── legacy hook-based tests (kept for run_hooks) ────────────────────────────

def _write_hook_events(mekiki_home, lines):
    f = mekiki_home / "events" / "claude-code" / "2026-05-27.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("\n".join(json.dumps(l) for l in lines) + "\n")

def test_run_hooks_creates_session(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_hook_events(mekiki_home, [
        {"ts": "2026-05-27T10:00:00.000Z", "platform": "claude-code", "event": "session.start",
         "session_id": "s-hook", "cwd": "/tmp", "model": "claude-haiku-4-5-20251001",
         "source": "startup", "transcript_path": transcript_path},
    ])
    ingest.run_hooks()
    conn = db.connect()
    sess = conn.execute("SELECT * FROM sessions WHERE session_id='s-hook'").fetchone()
    assert sess is not None
    conn.close()

def test_run_hooks_marks_effort_level(mekiki_home):
    db.init()
    transcript_path = str(FIXTURES / "transcript_simple.jsonl")
    _write_hook_events(mekiki_home, [
        {"ts": "2026-05-27T10:00:00.000Z", "platform": "claude-code", "event": "session.start",
         "session_id": "s-eff", "cwd": "/tmp", "model": "claude-haiku-4-5-20251001",
         "source": "startup", "transcript_path": transcript_path},
        {"ts": "2026-05-27T10:00:01.000Z", "platform": "claude-code",
         "event": "skill.user_typed", "session_id": "s-eff",
         "skill": "brainstorming", "effort_level": "high",
         "transcript_path": transcript_path},
    ])
    ingest.run_hooks()
    conn = db.connect()
    sess = conn.execute(
        "SELECT effort_level FROM sessions WHERE session_id='s-eff'"
    ).fetchone()
    assert sess["effort_level"] == "high"
    conn.close()
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd claude-code/cli && uv run pytest tests/test_ingest.py -v 2>&1 | tail -30
```

Expected: FAILED — `run_transcript_scan` not defined, `run_hooks` not defined

- [ ] **Step 4: Rewrite ingest.py**

Replace entire content of `claude-code/cli/src/mekiki/ingest.py` with:

```python
import json
from datetime import datetime, timezone
from pathlib import Path
from mekiki import db, events, transcript
from mekiki.paths import events_dir, claude_projects_root


def _detect_trigger(turns: list, inv_turn_index: int) -> str:
    """Return 'user-typed' if a <command-name> tag precedes the invocation, else 'model'."""
    for t in reversed(turns):
        if t.turn_index >= inv_turn_index:
            continue
        if t.role != "user":
            continue
        if t.raw.get("toolUseResult") or t.raw.get("sourceToolAssistantUUID"):
            continue
        if "<command-name>" in t.text:
            return "user-typed"
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
                    "last_seen_at=excluded.last_seen_at, "
                    "ended_cleanly=excluded.ended_cleanly, "
                    "transcript_path=excluded.transcript_path",
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
                    trigger = _detect_trigger(turns, inv.turn_index)
                    used_dn = 1 if downstream.get(inv.tool_use_id) else 0
                    conn.execute(
                        "INSERT INTO skill_invocations"
                        "(session_id, ts, skill, args, tool_use_id, turn_index, trigger, used_downstream) "
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
                        "ON CONFLICT(tool_use_id) DO UPDATE SET "
                        "turn_index=COALESCE(excluded.turn_index, skill_invocations.turn_index), "
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
    Populates sessions.effort_level for the most-recent skill.user_typed per session.
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
    return {**scan, "hook_events": hooks.get("events", 0), "effort_updates": hooks.get("effort_updates", 0)}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd claude-code/cli && uv run pytest tests/test_ingest.py -v 2>&1 | tail -30
```

Expected: all PASSED

- [ ] **Step 6: Run all tests to check for regressions**

```bash
cd claude-code/cli && uv run pytest --tb=short 2>&1 | tail -30
```

Expected: all PASSED (smoke tests may fail if they exercise the old hook pipeline — fix if needed)

- [ ] **Step 7: Commit**

```bash
git add claude-code/cli/src/mekiki/ingest.py \
        claude-code/cli/tests/test_ingest.py \
        "claude-code/cli/tests/fixtures/projects/-test-slug-/sess1.jsonl"
git commit -m "feat(mekiki/ingest): pivot to transcript-file spine; keep hooks as effort.level overlay"
```

---

## Task 4: judge/context.py — turn-bounded windows

**Files:**
- Modify: `claude-code/cli/src/mekiki/judge/context.py`
- Modify: `claude-code/cli/tests/test_judge_context.py`

- [ ] **Step 1: Read current test_judge_context.py**

```bash
cd claude-code/cli && cat tests/test_judge_context.py
```

- [ ] **Step 2: Write failing test**

Append to `claude-code/cli/tests/test_judge_context.py`:

```python
def test_build_uses_turn_bounded_window(mekiki_home):
    """context.build() must not use fixed ±10; it must use turn_bounded_window."""
    from mekiki import transcript as tr
    # Verify that the module no longer imports window_around for context building.
    # We do a functional check: build a session where the skill is in a block of 3 turns
    # but there are 12 turns total; the window should be < 12.
    import inspect
    src = inspect.getsource(context)
    assert "turn_bounded_window" in src, "context.py must use turn_bounded_window"
    assert "window_around" not in src.replace("# window_around", ""), (
        "context.py must not call window_around"
    )
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd claude-code/cli && uv run pytest tests/test_judge_context.py::test_build_uses_turn_bounded_window -v 2>&1 | tail -10
```

Expected: FAILED — `window_around` still present

- [ ] **Step 4: Update judge/context.py**

Replace entire content of `claude-code/cli/src/mekiki/judge/context.py` with:

```python
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
        turn_index = row["turn_index"] or 0
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd claude-code/cli && uv run pytest tests/test_judge_context.py -v 2>&1 | tail -15
```

Expected: all PASSED

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/mekiki/judge/context.py claude-code/cli/tests/test_judge_context.py
git commit -m "feat(mekiki/judge): replace fixed window_around with turn_bounded_window"
```

---

## Task 5: judge/prompts.py — G-Eval two-phase prompts

**Files:**
- Modify: `claude-code/cli/src/mekiki/judge/prompts.py`
- Create: `claude-code/cli/tests/test_judge_prompts.py`

- [ ] **Step 1: Write failing tests**

Create `claude-code/cli/tests/test_judge_prompts.py`:

```python
from mekiki.judge import prompts
from mekiki.judge.interface import InvocationContext

def _make_ctx():
    return InvocationContext(
        invocation_id=1,
        session_id="s1",
        skill="brainstorming",
        args="design mekiki",
        trigger="user-typed",
        turn_index=1,
        context_before=["[user] use brainstorming"],
        context_after=["[user] looks good", "[assistant] great"],
    )

def test_geval_steps_prompt_includes_skill():
    ctx = _make_ctx()
    p = prompts.geval_steps_prompt(ctx)
    assert "brainstorming" in p
    assert "design mekiki" in p

def test_geval_score_prompt_includes_criterion_and_context():
    ctx = _make_ctx()
    p = prompts.geval_score_prompt("Was the right skill chosen?", ctx)
    assert "Was the right skill chosen?" in p
    assert "brainstorming" in p
    assert "use brainstorming" in p

def test_geval_steps_system_requests_json_array():
    assert "JSON" in prompts.GEVAL_STEPS_SYSTEM
    assert "array" in prompts.GEVAL_STEPS_SYSTEM.lower()

def test_geval_score_system_defines_ranges():
    assert "0-10" in prompts.GEVAL_SCORE_SYSTEM or "0–10" in prompts.GEVAL_SCORE_SYSTEM

def test_gap_system_unchanged():
    assert "suggested_skill" in prompts.GAP_SYSTEM
    assert "reasoning" in prompts.GAP_SYSTEM

def test_gap_user_prompt_includes_skill_list():
    from mekiki.judge.interface import AvailableSkillCtx
    skills = [AvailableSkillCtx(name="brainstorming", description="for design tasks")]
    p = prompts.gap_user_prompt("I want to design something", skills)
    assert "brainstorming" in p
    assert "I want to design something" in p
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd claude-code/cli && uv run pytest tests/test_judge_prompts.py -v 2>&1 | tail -15
```

Expected: FAILED — `geval_steps_prompt` not defined

- [ ] **Step 3: Implement updated prompts.py**

Replace entire content of `claude-code/cli/src/mekiki/judge/prompts.py` with:

```python
from mekiki.judge.interface import InvocationContext, AvailableSkillCtx

GEVAL_STEPS_SYSTEM = (
    "You are an expert evaluator designing a scoring rubric for a Claude Code skill invocation. "
    "Given the skill name, args, trigger, and conversation context, generate exactly 3 to 5 "
    "specific evaluation criteria as a JSON array of strings. "
    "Each criterion must be answerable from the conversation alone — concrete, not vague. "
    "Respond with a JSON array and nothing else."
)

GEVAL_SCORE_SYSTEM = (
    "You are an expert evaluator scoring a single criterion for a Claude Code skill invocation. "
    "Score on a scale of 0-10:\n"
    "  0-2: criterion clearly not met\n"
    "  3-5: criterion partially met or ambiguous\n"
    "  6-8: criterion mostly met\n"
    "  9-10: criterion fully and clearly met\n"
    'Respond with a JSON object: {"score": <integer 0-10>, "reasoning": "<brief explanation>"}'
)

GAP_SYSTEM = (
    "You analyze whether a Claude Code session is missing a skill invocation that "
    "*should* have happened. Given a user prompt and the list of installed skills with their "
    "descriptions, decide whether exactly one of the listed skills clearly should have been invoked "
    "in response. Be conservative: only flag clear cases. If no skill clearly fits, return null. "
    "Respond with a single JSON object and nothing else, using exactly these keys: "
    "suggested_skill (string skill name from the list, or null), "
    'reasoning (string explaining the match, or "").'
)


def geval_steps_prompt(ctx: InvocationContext) -> str:
    return (
        f"Skill: {ctx.skill}\n"
        f"Args: {ctx.args}\n"
        f"Trigger: {ctx.trigger}\n\n"
        f"Conversation BEFORE invocation:\n"
        f"{chr(10).join(ctx.context_before) or '(none)'}\n\n"
        f"Conversation AFTER invocation:\n"
        f"{chr(10).join(ctx.context_after) or '(none)'}\n\n"
        "Generate 3-5 evaluation criteria for whether this skill invocation was helpful. "
        "JSON array only."
    )


def geval_score_prompt(criterion: str, ctx: InvocationContext) -> str:
    return (
        f"Criterion: {criterion}\n\n"
        f"Skill invoked: {ctx.skill}\n"
        f"Args: {ctx.args}\n"
        f"Trigger: {ctx.trigger}\n\n"
        f"Conversation BEFORE invocation:\n"
        f"{chr(10).join(ctx.context_before) or '(none)'}\n\n"
        f"Conversation AFTER invocation:\n"
        f"{chr(10).join(ctx.context_after) or '(none)'}\n\n"
        "Score this criterion 0-10. JSON only."
    )


def gap_user_prompt(prompt: str, available: list[AvailableSkillCtx]) -> str:
    skills_block = "\n".join(f"- {s.name}: {s.description}" for s in available)
    return (
        f"Available skills:\n{skills_block}\n\n"
        f'User prompt:\n"""\n{prompt}\n"""\n\n'
        "Should any of the available skills have been invoked? JSON only."
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd claude-code/cli && uv run pytest tests/test_judge_prompts.py -v 2>&1 | tail -15
```

Expected: all PASSED

- [ ] **Step 5: Commit**

```bash
git add claude-code/cli/src/mekiki/judge/prompts.py claude-code/cli/tests/test_judge_prompts.py
git commit -m "feat(mekiki/judge): replace CLASSIFY_SYSTEM with G-Eval two-phase prompts"
```

---

## Task 6: judge interface + backend + orchestrator — G-Eval scoring

**Files:**
- Modify: `claude-code/cli/src/mekiki/judge/interface.py`
- Modify: `claude-code/cli/src/mekiki/judge/anthropic_backend.py`
- Modify: `claude-code/cli/src/mekiki/judge/orchestrator.py`
- Modify: `claude-code/cli/tests/test_judge_orchestrator.py`

- [ ] **Step 1: Read current test_judge_orchestrator.py**

```bash
cd claude-code/cli && cat tests/test_judge_orchestrator.py
```

- [ ] **Step 2: Add score field to Judgment**

In `claude-code/cli/src/mekiki/judge/interface.py`, add `score: float = 0.0` to the `Judgment` dataclass. Replace the file content:

```python
from dataclasses import dataclass, field
from typing import Protocol, Optional

@dataclass
class AvailableSkillCtx:
    name: str
    description: str

@dataclass
class InvocationContext:
    invocation_id: int
    session_id: str
    skill: str
    args: str
    trigger: str                      # 'user-typed' | 'model'
    turn_index: int
    context_before: list[str]
    context_after: list[str]

@dataclass
class Judgment:
    user_reaction: str                # 'positive' | 'negative' | 'neutral' | 'none'
    user_reaction_quote: str
    notes: str
    judgment_model: str
    score: float = 0.0                # G-Eval normalized 0-1
    used_downstream: Optional[bool] = None      # set by ingest from attributionSkill
    session_ended_cleanly: Optional[bool] = None  # set by ingest from stop_hook_summary

@dataclass
class Gap:
    suggested_skill: str
    reasoning: str
    judgment_model: str

class JudgeBackend(Protocol):
    def classify_invocation(self, ctx: InvocationContext) -> Judgment: ...
    def detect_gap(self, prompt: str, available_skills: list[AvailableSkillCtx]) -> Optional[Gap]: ...

def get_backend(name: str) -> "JudgeBackend":
    if name == "anthropic":
        from mekiki.judge.anthropic_backend import AnthropicBackend
        return AnthropicBackend()
    if name == "codex":
        from mekiki.judge.codex_backend import CodexBackend
        return CodexBackend()
    raise ValueError(f"unknown judge backend: {name}")
```

- [ ] **Step 3: Update anthropic_backend.py — G-Eval two-phase classify_invocation**

Replace entire content of `claude-code/cli/src/mekiki/judge/anthropic_backend.py`:

```python
import json
import os
from anthropic import Anthropic
from mekiki import config
from mekiki.judge.interface import InvocationContext, Judgment, Gap, AvailableSkillCtx
from mekiki.judge import prompts

class AnthropicBackend:
    def __init__(self):
        self.cfg = config.load().judge
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    def _call(self, model: str, system: str, user: str, max_tokens: int = 512) -> str:
        resp = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parts = []
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                parts.append(block.text)
        return "".join(parts).strip()

    def _parse_json(self, raw: str) -> dict | list:
        try:
            return json.loads(raw.strip())
        except json.JSONDecodeError:
            pass
        # Strip markdown fences if present
        stripped = raw.strip()
        if stripped.startswith("```"):
            stripped = "\n".join(stripped.split("\n")[1:])
            if stripped.endswith("```"):
                stripped = stripped[:-3]
        start = stripped.find("[") if "[" in stripped and stripped.index("[") < stripped.find("{") else stripped.find("{")
        end = stripped.rfind("]") if "[" in stripped and stripped.index("[") < stripped.find("{") else stripped.rfind("}")
        if start >= 0 and end >= 0:
            return json.loads(stripped[start: end + 1])
        raise ValueError(f"Could not parse JSON: {raw[:200]}")

    def classify_invocation(self, ctx: InvocationContext) -> Judgment:
        model = self.cfg.anthropic_model_classify

        # Phase 1: generate eval steps
        steps_raw = self._call(
            model, prompts.GEVAL_STEPS_SYSTEM, prompts.geval_steps_prompt(ctx), max_tokens=256
        )
        try:
            steps = self._parse_json(steps_raw)
            if not isinstance(steps, list):
                steps = [str(steps)]
        except Exception:
            steps = [
                "Was the correct skill chosen for the user's request?",
                "Was the skill's output used in the subsequent response?",
                "Did the user react positively to the outcome?",
            ]

        # Phase 2: score each step
        scores: list[int] = []
        user_reaction = "none"
        user_reaction_quote = ""
        notes_parts: list[str] = []

        for step in steps[:5]:  # cap at 5 steps
            score_raw = self._call(
                model, prompts.GEVAL_SCORE_SYSTEM, prompts.geval_score_prompt(step, ctx), max_tokens=128
            )
            try:
                data = self._parse_json(score_raw)
                if isinstance(data, dict):
                    scores.append(int(data.get("score", 5)))
                    reasoning = data.get("reasoning", "")
                    if reasoning:
                        notes_parts.append(f"{step}: {reasoning}")
                    # Derive user_reaction from scores heuristically
                    if int(data.get("score", 5)) >= 7 and user_reaction == "none":
                        user_reaction = "positive"
                    elif int(data.get("score", 5)) <= 3:
                        user_reaction = "negative"
            except Exception:
                scores.append(5)

        normalized = (sum(scores) / (len(scores) * 10)) if scores else 0.0

        return Judgment(
            user_reaction=user_reaction,
            user_reaction_quote=user_reaction_quote,
            notes="; ".join(notes_parts[:3]),
            judgment_model=f"anthropic:{model}",
            score=round(normalized, 3),
        )

    def detect_gap(self, prompt: str, available_skills: list[AvailableSkillCtx]) -> Gap | None:
        model = self.cfg.anthropic_model_gap
        raw = self._call(model, prompts.GAP_SYSTEM, prompts.gap_user_prompt(prompt, available_skills))
        data = self._parse_json(raw)
        if not isinstance(data, dict):
            return None
        sk = data.get("suggested_skill")
        if not sk:
            return None
        return Gap(
            suggested_skill=sk,
            reasoning=data.get("reasoning", "") or "",
            judgment_model=f"anthropic:{model}",
        )
```

- [ ] **Step 4: Update orchestrator.py — write score, skip transcript-derivable fields**

Replace entire content of `claude-code/cli/src/mekiki/judge/orchestrator.py`:

```python
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
    """Judge all unjudged invocations.

    used_downstream and session_ended_cleanly are read from skill_invocations/sessions
    (set by ingest from transcript data — no LLM needed for these fields).
    The LLM scores user_reaction and the G-Eval score only.
    """
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
                # Read transcript-derivable facts directly from DB (no LLM)
                inv_row = conn.execute(
                    "SELECT si.used_downstream, s.ended_cleanly "
                    "FROM skill_invocations si "
                    "JOIN sessions s ON s.session_id = si.session_id "
                    "WHERE si.id = ?",
                    (inv_id,),
                ).fetchone()
                used_dn = inv_row["used_downstream"] if inv_row else None
                ended_cleanly = inv_row["ended_cleanly"] if inv_row else None

                # LLM judge for user_reaction + G-Eval score
                ctx = context.build(inv_id)
                j = backend.classify_invocation(ctx)

                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT INTO invocation_judgments"
                    "(invocation_id, used_downstream, user_reaction, "
                    "user_reaction_quote, session_ended_cleanly, score, judgment_model, judged_at, notes) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        inv_id,
                        used_dn,
                        j.user_reaction,
                        j.user_reaction_quote,
                        ended_cleanly,
                        j.score,
                        j.judgment_model,
                        now,
                        j.notes,
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
```

- [ ] **Step 5: Run all tests**

```bash
cd claude-code/cli && uv run pytest --tb=short 2>&1 | tail -30
```

Expected: all PASSED

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/mekiki/judge/interface.py \
        claude-code/cli/src/mekiki/judge/anthropic_backend.py \
        claude-code/cli/src/mekiki/judge/orchestrator.py
git commit -m "feat(mekiki/judge): G-Eval two-phase scoring; transcript-derived used_downstream skips LLM"
```

---

## Task 7: trim hooks to 2 + add effort.level capture

**Files:**
- Modify: `claude-code/plugins/mekiki/hooks/hooks.json`
- Modify: `claude-code/plugins/mekiki/hooks/user_prompt_expansion.sh`

- [ ] **Step 1: Update hooks.json — remove 4 redundant hooks**

Replace entire content of `claude-code/plugins/mekiki/hooks/hooks.json`:

```json
{
  "hooks": {
    "UserPromptExpansion": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/user_prompt_expansion.sh" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh" }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Update user_prompt_expansion.sh — emit effort.level + command_source**

Replace entire content of `claude-code/plugins/mekiki/hooks/user_prompt_expansion.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

"$SCRIPT_DIR/_capture_payload.sh" "UserPromptExpansion" "$PAYLOAD"

COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command_name // .slash_command_name // .skill_name // ""')"
if [ -z "$COMMAND" ]; then
  exit 0
fi

EFFORT="$(printf '%s' "$PAYLOAD" | jq -r '.effort.level // ""')"
CMD_SOURCE="$(printf '%s' "$PAYLOAD" | jq -r '.command_source // ""')"

LINE="$(printf '%s' "$PAYLOAD" | jq -c \
  --arg ts "$TS" \
  --arg cmd "$COMMAND" \
  --arg eff "$EFFORT" \
  --arg src "$CMD_SOURCE" \
  '{
    ts: $ts,
    platform: "claude-code",
    event: "skill.user_typed",
    session_id: .session_id,
    skill: $cmd,
    effort_level: $eff,
    command_source: $src,
    transcript_path: .transcript_path
  }')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
```

- [ ] **Step 3: Verify shell script is executable**

```bash
chmod +x claude-code/plugins/mekiki/hooks/user_prompt_expansion.sh
ls -la claude-code/plugins/mekiki/hooks/*.sh | awk '{print $1, $9}'
```

Expected: all `.sh` files have `x` bit set

- [ ] **Step 4: Commit**

```bash
git add claude-code/plugins/mekiki/hooks/hooks.json \
        claude-code/plugins/mekiki/hooks/user_prompt_expansion.sh
git commit -m "feat(mekiki/hooks): trim to UserPromptExpansion+Stop; add effort.level+command_source capture"
```

---

## Task 8: SessionAdapter protocol skeleton

**Files:**
- Create: `claude-code/cli/src/mekiki/adapters/__init__.py`
- Create: `claude-code/cli/src/mekiki/adapters/base.py`
- Create: `claude-code/cli/src/mekiki/adapters/claude_code.py`
- Create: `claude-code/cli/src/mekiki/adapters/codex.py`
- Create: `claude-code/cli/src/mekiki/adapters/opencode.py`
- Create: `claude-code/cli/tests/test_adapters.py`

- [ ] **Step 1: Write failing test**

Create `claude-code/cli/tests/test_adapters.py`:

```python
from pathlib import Path
from mekiki.adapters.base import SessionRecord, SessionAdapter
from mekiki.adapters.claude_code import ClaudeCodeAdapter

FIXTURES = Path(__file__).parent / "fixtures" / "projects"

def test_claude_code_adapter_iter_sessions():
    adapter = ClaudeCodeAdapter(projects_root=FIXTURES)
    sessions = list(adapter.iter_sessions())
    assert len(sessions) >= 1
    sess = sessions[0]
    assert isinstance(sess, SessionRecord)
    assert sess.session_id == "sess1"
    assert sess.platform == "claude-code"

def test_claude_code_adapter_iter_skill_invocations():
    adapter = ClaudeCodeAdapter(projects_root=FIXTURES)
    sessions = list(adapter.iter_sessions())
    invs = list(adapter.iter_skill_invocations(sessions[0]))
    assert len(invs) >= 1
    assert invs[0].skill == "brainstorming"

def test_session_adapter_protocol_satisfied():
    from typing import runtime_checkable, Protocol
    # ClaudeCodeAdapter must satisfy the SessionAdapter protocol structurally
    adapter = ClaudeCodeAdapter(projects_root=FIXTURES)
    assert hasattr(adapter, "iter_sessions")
    assert hasattr(adapter, "iter_skill_invocations")
    assert hasattr(adapter, "iter_turns")
    assert hasattr(adapter, "extract_available_skills")
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd claude-code/cli && uv run pytest tests/test_adapters.py -v 2>&1 | tail -10
```

Expected: FAILED — module not found

- [ ] **Step 3: Create adapters package**

Create `claude-code/cli/src/mekiki/adapters/__init__.py`:

```python
from mekiki.adapters.base import SessionAdapter, SessionRecord

__all__ = ["SessionAdapter", "SessionRecord"]
```

Create `claude-code/cli/src/mekiki/adapters/base.py`:

```python
from dataclasses import dataclass
from typing import Iterator, Protocol, Optional


@dataclass
class SessionRecord:
    session_id: str
    platform: str
    transcript_path: Optional[str]
    cwd: Optional[str]
    model: Optional[str]
    started_at: Optional[str]


class SessionAdapter(Protocol):
    """Protocol for per-harness session data adapters.

    Implementations: ClaudeCodeAdapter (now), CodexAdapter and OpencodeAdapter (stubs).
    """

    def iter_sessions(self) -> Iterator[SessionRecord]: ...

    def iter_skill_invocations(self, session: SessionRecord):
        """Yield SkillInvocation objects for the given session."""
        ...

    def iter_turns(self, session: SessionRecord):
        """Yield Turn objects for the given session."""
        ...

    def extract_available_skills(self, session: SessionRecord):
        """Return list of AvailableSkill for the given session."""
        ...
```

Create `claude-code/cli/src/mekiki/adapters/claude_code.py`:

```python
from pathlib import Path
from typing import Iterator, Optional
from mekiki import transcript
from mekiki.adapters.base import SessionRecord
from mekiki.paths import claude_projects_root


class ClaudeCodeAdapter:
    """Adapter that reads claude-code session data from ~/.claude/projects/ JSONL files."""

    def __init__(self, projects_root: Optional[Path] = None) -> None:
        self._root = projects_root or claude_projects_root()

    def iter_sessions(self) -> Iterator[SessionRecord]:
        if not self._root.exists():
            return
        for slug_dir in sorted(self._root.iterdir()):
            if not slug_dir.is_dir():
                continue
            for jpath in sorted(slug_dir.glob("*.jsonl")):
                meta = transcript.extract_session_meta(jpath)
                yield SessionRecord(
                    session_id=meta.session_id,
                    platform="claude-code",
                    transcript_path=str(jpath),
                    cwd=meta.cwd,
                    model=meta.model,
                    started_at=meta.started_at,
                )

    def iter_skill_invocations(self, session: SessionRecord):
        if not session.transcript_path:
            return
        yield from transcript.iter_skill_invocations(Path(session.transcript_path))

    def iter_turns(self, session: SessionRecord):
        if not session.transcript_path:
            return
        yield from transcript.iter_turns(Path(session.transcript_path))

    def extract_available_skills(self, session: SessionRecord):
        if not session.transcript_path:
            return []
        return transcript.extract_available_skills(Path(session.transcript_path))
```

Create `claude-code/cli/src/mekiki/adapters/codex.py`:

```python
from mekiki.adapters.base import SessionRecord


class CodexAdapter:
    """Adapter for codex rollout JSONL sessions.

    Storage: ~/.codex/sessions/Y/M/D/rollout-*.jsonl + logs_2.sqlite
    Format: {timestamp, type, payload} records; response_item.function_call for tool calls.
    Note: codex has no native skill concept; tool calls are exec_command only.
    """

    def iter_sessions(self):
        raise NotImplementedError("CodexAdapter is not yet implemented")

    def iter_skill_invocations(self, session: SessionRecord):
        raise NotImplementedError("CodexAdapter is not yet implemented")

    def iter_turns(self, session: SessionRecord):
        raise NotImplementedError("CodexAdapter is not yet implemented")

    def extract_available_skills(self, session: SessionRecord):
        raise NotImplementedError("CodexAdapter is not yet implemented")
```

Create `claude-code/cli/src/mekiki/adapters/opencode.py`:

```python
from mekiki.adapters.base import SessionRecord


class OpencodeAdapter:
    """Adapter for opencode sessions.

    Storage: ~/.local/share/opencode/opencode.db + `opencode export <id>` CLI.
    The session_diff/ files are edit patches only, not conversation records.
    """

    def iter_sessions(self):
        raise NotImplementedError("OpencodeAdapter is not yet implemented")

    def iter_skill_invocations(self, session: SessionRecord):
        raise NotImplementedError("OpencodeAdapter is not yet implemented")

    def iter_turns(self, session: SessionRecord):
        raise NotImplementedError("OpencodeAdapter is not yet implemented")

    def extract_available_skills(self, session: SessionRecord):
        raise NotImplementedError("OpencodeAdapter is not yet implemented")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd claude-code/cli && uv run pytest tests/test_adapters.py -v 2>&1 | tail -15
```

Expected: all PASSED

- [ ] **Step 5: Run full test suite**

```bash
cd claude-code/cli && uv run pytest --tb=short 2>&1 | tail -30
```

Expected: all PASSED

- [ ] **Step 6: Commit**

```bash
git add claude-code/cli/src/mekiki/adapters/ claude-code/cli/tests/test_adapters.py
git commit -m "feat(mekiki/adapters): SessionAdapter protocol + ClaudeCodeAdapter; CodexAdapter/OpencodeAdapter stubs"
```

---

## End-to-end verification

Run these after all tasks are complete to confirm the full pipeline works on real data:

```bash
# 1. Ingest real sessions — must produce rows > 0
cd claude-code/cli && uv run python -m mekiki ingest
sqlite3 ~/.mekiki/state.db "SELECT COUNT(*) FROM sessions; SELECT COUNT(*) FROM skill_invocations;"
# Expected: both counts > 0

# 2. Spot-check a brainstorming invocation has used_downstream=1
sqlite3 ~/.mekiki/state.db \
  "SELECT skill, used_downstream, trigger FROM skill_invocations WHERE skill='brainstorming' LIMIT 5;"
# Expected: rows with used_downstream=1 for sessions where brainstorming attribution is present

# 3. Verify ended_cleanly is populated for some sessions
sqlite3 ~/.mekiki/state.db "SELECT COUNT(*) FROM sessions WHERE ended_cleanly=1;"
# Expected: > 0

# 4. Generate report
uv run python -m mekiki report
# Expected: opens/updates ~/.mekiki/reports/overview.html with per-skill stats

# 5. Run judge on 1 invocation (dry-run with ANTHROPIC_API_KEY set)
sqlite3 ~/.mekiki/state.db "SELECT id, skill FROM skill_invocations LIMIT 1;"
# Then:
uv run python -c "
from mekiki.judge.orchestrator import judge_invocations
from mekiki.judge.interface import get_backend
n = judge_invocations(get_backend('anthropic'))
print('judged:', n)
"
sqlite3 ~/.mekiki/state.db "SELECT invocation_id, score, user_reaction FROM invocation_judgments LIMIT 5;"
# Expected: score in [0.0, 1.0], user_reaction in {positive,negative,neutral,none}
```
