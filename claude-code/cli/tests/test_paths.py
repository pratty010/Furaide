from satori import paths

def test_home_uses_env_var(satori_home):
    assert paths.home() == satori_home

def test_home_defaults_to_hidden_dir(monkeypatch):
    monkeypatch.delenv("SATORI_HOME", raising=False)
    assert paths.home().name == ".satori"

def test_events_dir_created(satori_home):
    d = paths.events_dir()
    assert d.exists() and d.is_dir()
    assert d == satori_home / "events" / "claude-code"

def test_state_db_path(satori_home):
    assert paths.state_db() == satori_home / "state.db"

def test_config_defaults_when_no_file(satori_home):
    from satori import config
    cfg = config.load()
    assert cfg.judge.backend == "anthropic"
    assert cfg.improve.min_sample_size == 20
