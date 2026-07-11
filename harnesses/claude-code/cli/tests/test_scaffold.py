"""Smoke tests for the Python scaffold in harnesses/claude-code/cli.

There is no real package here yet — this just verifies the uv/pytest
environment itself is sane, so the pre-commit gate has something honest
to check until a real Python component lands.
"""

import sys

import pytest


def test_python_version_meets_declared_minimum():
    """pyproject.toml declares requires-python = ">=3.11"; enforce it."""
    assert sys.version_info >= (3, 11), (
        f"running Python {sys.version_info.major}.{sys.version_info.minor}, "
        "expected >=3.11 per pyproject.toml"
    )


def test_pytest_is_importable_and_usable():
    """pytest itself must be a working, importable dependency."""
    assert pytest.__version__
    major = int(pytest.__version__.split(".")[0])
    assert major >= 8
