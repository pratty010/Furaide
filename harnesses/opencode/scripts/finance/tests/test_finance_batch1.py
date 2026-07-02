from __future__ import annotations

import json
import subprocess
from pathlib import Path


FINANCE_DIR = Path(__file__).resolve().parents[1]
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "synthetic_10k_facts.json"


def run_script(script_name: str, tmp_path: Path) -> dict:
    output_path = tmp_path / f"{script_name}.json"
    subprocess.run(
        [
            "uv",
            "run",
            script_name,
            "--input",
            str(FIXTURE_PATH),
            "--output",
            str(output_path),
        ],
        cwd=FINANCE_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(output_path.read_text(encoding="utf-8"))


def row_by_code(rows: list[dict], code: str) -> dict:
    return next(row for row in rows if row["row_code"] == code)


def fact_by_concept(facts: list[dict], concept: str) -> dict:
    return next(fact for fact in facts if fact["canonical_concept"] == concept)


def test_finance_xbrl_extract_maps_facts_to_canonical_concepts(tmp_path: Path) -> None:
    payload = run_script("finance_xbrl_extract.py", tmp_path)

    assert payload["ok"] is True
    assert payload["errors"] == []
    assert payload["provenance"] == {
        "source_ids": ["sec-facts-acme-2025"],
        "retrieved": "2026-07-02T12:00:00Z",
        "script": "finance_xbrl_extract",
        "version": "0.1.0",
    }

    revenue = fact_by_concept(payload["data"]["facts"], "revenue")
    shares = fact_by_concept(payload["data"]["facts"], "shares_outstanding")

    assert revenue["value"] == 125.0
    assert revenue["unit"] == "USD_millions"
    assert revenue["period"] == {
        "start": "2025-01-01",
        "end": "2025-12-31",
        "type": "duration",
    }
    assert revenue["context"] == "FY2025"
    assert revenue["source_concept"] == "RevenueFromContractWithCustomerExcludingAssessedTax"

    assert shares["statement"] == "balance_sheet"
    assert shares["period"] == {"end": "2025-12-31", "type": "instant"}


def test_finance_statement_normalize_outputs_canonical_statement_rows(tmp_path: Path) -> None:
    payload = run_script("finance_statement_normalize.py", tmp_path)

    assert payload["ok"] is True
    statements = payload["data"]["statements"]
    revenue = row_by_code(statements["income_statement"], "revenue")
    capex = row_by_code(statements["cash_flow"], "capital_expenditures")
    equity = row_by_code(statements["balance_sheet"], "equity")

    assert revenue["value"] == 125.0
    assert revenue["sign"] == 1
    assert revenue["scale"] == "million"
    assert revenue["source_concept"] == "RevenueFromContractWithCustomerExcludingAssessedTax"

    assert capex["value"] == -12.0
    assert capex["sign"] == -1
    assert capex["source_tag"] == "xbrl_fact"

    assert equity["value"] == 250.0
    assert equity["statement"] == "balance_sheet"


def test_finance_unit_normalize_handles_currency_scale_and_share_counts(tmp_path: Path) -> None:
    payload = run_script("finance_unit_normalize.py", tmp_path)

    assert payload["ok"] is True
    normalized = payload["data"]["normalized_facts"]
    cash = fact_by_concept(normalized, "cash_and_cash_equivalents")
    shares = fact_by_concept(normalized, "shares_outstanding")
    revenue = fact_by_concept(normalized, "revenue")

    assert cash["normalized_value"] == 88000000.0
    assert cash["normalized_unit"] == "USD"
    assert cash["fx_rate"] == 1.1
    assert cash["fx_timestamp"] == "2025-12-31T16:00:00Z"

    assert shares["measurement"] == "shares"
    assert shares["scale"] == "million"
    assert shares["normalized_value"] == 100000000.0

    assert revenue["measurement"] == "currency"
    assert revenue["normalized_value"] == 125000000.0


def test_finance_corporate_actions_applies_split_and_dividend_metadata(tmp_path: Path) -> None:
    payload = run_script("finance_corporate_actions.py", tmp_path)

    assert payload["ok"] is True
    adjusted = payload["data"]["adjusted_facts"]
    shares = fact_by_concept(adjusted, "shares_outstanding")
    eps = fact_by_concept(adjusted, "eps_basic")

    assert shares["adjusted_value"] == 200.0
    assert shares["adjustment_factor"] == 2.0
    assert shares["adjustments_applied"][0]["type"] == "split"

    assert eps["adjusted_value"] == 2.0
    assert eps["adjustment_factor"] == 0.5

    assert payload["data"]["dividend_metadata"] == [
        {
            "cash_dividend_per_share": 0.5,
            "currency": "USD",
            "effective_date": "2026-02-01",
            "type": "dividend",
        }
    ]
