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
