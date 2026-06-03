from mekiki import paths

def test_home_uses_env_var(mekiki_home):
    assert paths.home() == mekiki_home

def test_home_defaults_to_hidden_dir(monkeypatch):
    monkeypatch.delenv("MEKIKI_HOME", raising=False)
    assert paths.home().name == ".mekiki"

def test_events_dir_created(mekiki_home):
    d = paths.events_dir()
    assert d.exists() and d.is_dir()
    assert d == mekiki_home / "events" / "claude-code"

def test_state_db_path(mekiki_home):
    assert paths.state_db() == mekiki_home / "state.db"

def test_config_defaults_when_no_file(mekiki_home):
    from mekiki import config
    cfg = config.load()
    assert cfg.judge.backend == "anthropic"
    assert cfg.improve.min_sample_size == 20
