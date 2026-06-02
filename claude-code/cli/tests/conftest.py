import os
import pytest
from pathlib import Path

@pytest.fixture
def satori_home(tmp_path, monkeypatch):
    home = tmp_path / "satori"
    home.mkdir()
    monkeypatch.setenv("SATORI_HOME", str(home))
    return home
