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
