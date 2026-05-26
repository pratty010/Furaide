from dataclasses import dataclass
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
    context_before: list[str]         # flattened role-prefixed text
    context_after: list[str]

@dataclass
class Judgment:
    used_downstream: Optional[bool]
    user_reaction: str                # 'positive' | 'negative' | 'neutral' | 'none'
    user_reaction_quote: str
    session_ended_cleanly: Optional[bool]
    notes: str
    judgment_model: str

@dataclass
class Gap:
    suggested_skill: str
    reasoning: str
    judgment_model: str

class JudgeBackend(Protocol):
    def classify_invocation(self, ctx: InvocationContext) -> Judgment: ...
    def detect_gap(self, prompt: str, available_skills: list[AvailableSkillCtx]) -> Optional[Gap]: ...

def get_backend(name: str) -> JudgeBackend:
    if name == "anthropic":
        from puraguin.judge.anthropic_backend import AnthropicBackend
        return AnthropicBackend()
    if name == "codex":
        from puraguin.judge.codex_backend import CodexBackend
        return CodexBackend()
    raise ValueError(f"unknown judge backend: {name}")
