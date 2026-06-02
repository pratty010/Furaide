from puraguin import paths

def test_home_uses_env_var(puraguin_home):
    assert paths.home() == puraguin_home

def test_home_defaults_to_hidden_dir(monkeypatch):
    monkeypatch.delenv("PURAGUIN_HOME", raising=False)
    assert paths.home().name == ".puraguin"

def test_events_dir_created(puraguin_home):
    d = paths.events_dir()
    assert d.exists() and d.is_dir()
    assert d == puraguin_home / "events" / "claude-code"

def test_state_db_path(puraguin_home):
    assert paths.state_db() == puraguin_home / "state.db"

def test_config_defaults_when_no_file(puraguin_home):
    from puraguin import config
    cfg = config.load()
    assert cfg.judge.backend == "anthropic"
    assert cfg.improve.min_sample_size == 20
