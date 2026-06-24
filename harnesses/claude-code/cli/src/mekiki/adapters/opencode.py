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
