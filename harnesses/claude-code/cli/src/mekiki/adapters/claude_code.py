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
