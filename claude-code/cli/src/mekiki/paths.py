import os
from pathlib import Path

def home() -> Path:
    return Path(os.environ.get("MEKIKI_HOME", str(Path.home() / ".mekiki")))

def events_dir(platform: str = "claude-code") -> Path:
    p = home() / "events" / platform
    p.mkdir(parents=True, exist_ok=True)
    return p

def state_db() -> Path:
    home().mkdir(parents=True, exist_ok=True)
    return home() / "state.db"

def evidence_dir() -> Path:
    p = home() / "evidence"
    p.mkdir(parents=True, exist_ok=True)
    return p

def reports_dir() -> Path:
    p = home() / "reports"
    p.mkdir(parents=True, exist_ok=True)
    return p

def config_file() -> Path:
    return home() / "config.toml"

def claude_projects_root() -> Path:
    return Path.home() / ".claude" / "projects"
