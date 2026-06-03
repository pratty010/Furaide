import os
import pytest
from pathlib import Path

@pytest.fixture
def mekiki_home(tmp_path, monkeypatch):
    home = tmp_path / "mekiki"
    home.mkdir()
    monkeypatch.setenv("MEKIKI_HOME", str(home))
    return home
