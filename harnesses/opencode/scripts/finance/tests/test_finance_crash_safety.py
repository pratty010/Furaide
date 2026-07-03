from __future__ import annotations

import json
import subprocess
from pathlib import Path


FINANCE_DIR = Path(__file__).resolve().parents[1]


def run_script_allow_failure(script_name: str, payload: dict, tmp_path: Path) -> tuple[int, dict]:
    input_path = tmp_path / f"{script_name}.input.json"
    output_path = tmp_path / f"{script_name}.output.json"
    input_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    result = subprocess.run(
        [
            "uv",
            "run",
            script_name,
            "--input",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=FINANCE_DIR,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.stderr == "", f"expected clean stderr, got traceback:\n{result.stderr}"
    assert output_path.exists(), "crash barrier must still write an envelope to --output"
    envelope = json.loads(output_path.read_text(encoding="utf-8"))
    return result.returncode, envelope


def test_finance_dcf_compute_wacc_equal_terminal_growth_yields_clean_envelope(tmp_path: Path) -> None:
    # wacc == terminal_growth drives a ZeroDivisionError in the terminal value formula
    # (wacc - terminal_growth) instead of an uncaught traceback.
    payload = {
        "source_ids": ["dcf-crash-fixture"],
        "retrieved": "2026-07-02T12:00:00Z",
        "base_case": {
            "fcff": [20.0, 22.0, 24.0],
            "wacc": 0.05,
            "terminal_growth": 0.05,
        },
    }

    returncode, envelope = run_script_allow_failure("finance_dcf_compute.py", payload, tmp_path)

    assert returncode in (0, 1)
    assert envelope["ok"] is False
    assert envelope["errors"]
    assert "ZeroDivisionError" in envelope["errors"][0]


def test_finance_xbrl_extract_missing_concept_key_yields_clean_envelope(tmp_path: Path) -> None:
    # A fact missing the required "concept" key drives a KeyError in extract_facts
    # instead of an uncaught traceback.
    payload = {
        "source_ids": ["xbrl-crash-fixture"],
        "retrieved": "2026-07-02T12:00:00Z",
        "entity": "ACME",
        "facts": [
            {
                "value": 125.0,
                "unit": "USD_millions",
                "period": {"start": "2025-01-01", "end": "2025-12-31", "type": "duration"},
            }
        ],
    }

    returncode, envelope = run_script_allow_failure("finance_xbrl_extract.py", payload, tmp_path)

    assert returncode in (0, 1)
    assert envelope["ok"] is False
    assert envelope["errors"]
    assert "KeyError" in envelope["errors"][0]


def test_finance_model_validate_non_numeric_discount_factor_yields_clean_envelope(tmp_path: Path) -> None:
    # A non-numeric discount factor drives a ValueError from float() instead of an
    # uncaught traceback.
    payload = {
        "source_ids": ["model-validate-crash-fixture"],
        "retrieved": "2026-07-02T12:00:00Z",
        "expected_unit": "USD_millions",
        "model": {
            "enterprise_value": 500.0,
            "equity_value": 450.0,
            "net_debt": 50.0,
            "share_count": 100.0,
            "diluted_share_count": 105.0,
            "unit": "USD_millions",
            "discount_factors": ["not-a-number", 0.9],
            "revenue_projection": [100.0, 110.0],
            "scenario_table": [{"name": "base"}],
        },
    }

    returncode, envelope = run_script_allow_failure("finance_model_validate.py", payload, tmp_path)

    assert returncode in (0, 1)
    assert envelope["ok"] is False
    assert envelope["errors"]
    assert "ValueError" in envelope["errors"][0]
