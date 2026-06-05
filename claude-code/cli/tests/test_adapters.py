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
    adapter = ClaudeCodeAdapter(projects_root=FIXTURES)
    assert hasattr(adapter, "iter_sessions")
    assert hasattr(adapter, "iter_skill_invocations")
    assert hasattr(adapter, "iter_turns")
    assert hasattr(adapter, "extract_available_skills")
