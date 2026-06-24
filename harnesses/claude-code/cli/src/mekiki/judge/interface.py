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
