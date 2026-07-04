from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


FINANCE_DIR = Path(__file__).resolve().parents[1]
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "batch23_inputs.json"
FIXTURES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def run_script(script_name: str, fixture_name: str, tmp_path: Path) -> dict:
    input_path = tmp_path / f"{fixture_name}.input.json"
    output_path = tmp_path / f"{script_name}.json"
    input_path.write_text(json.dumps(FIXTURES[fixture_name], indent=2) + "\n", encoding="utf-8")
    subprocess.run(
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
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(output_path.read_text(encoding="utf-8"))


def metric_by_name(metrics: list[dict], name: str) -> dict:
    return next(item for item in metrics if item["name"] == name)


def scenario_by_name(rows: list[dict], name: str) -> dict:
    return next(item for item in rows if item["name"] == name)


def artifact_by_name(rows: list[dict], name: str) -> dict:
    return next(item for item in rows if item["name"] == name)


def test_finance_ratio_compute_outputs_ratios_and_dupont_definitions(tmp_path: Path) -> None:
    payload = run_script("finance_ratio_compute.py", "ratio", tmp_path)

    assert payload["ok"] is True
    ratios = payload["data"]["ratios"]

    net_margin = metric_by_name(ratios, "net_margin")
    asset_turnover = metric_by_name(ratios, "asset_turnover")
    equity_multiplier = metric_by_name(ratios, "equity_multiplier")
    roe = metric_by_name(ratios, "return_on_equity")
    fcf_margin = metric_by_name(ratios, "free_cash_flow_margin")

    assert net_margin["value"] == pytest.approx(0.2)
    assert net_margin["definition"] == {"numerator": "net_income", "denominator": "revenue"}
    assert asset_turnover["value"] == pytest.approx(25 / 76, abs=1e-6)
    assert asset_turnover["definition"] == {"numerator": "revenue", "denominator": "average_assets"}
    assert equity_multiplier["value"] == pytest.approx(380 / 235, abs=1e-6)
    assert roe["value"] == pytest.approx(25 / 235, abs=1e-6)
    assert fcf_margin["value"] == pytest.approx(18 / 125, abs=1e-6)
    dupont = payload["data"]["dupont"]
    assert dupont["net_margin"] == pytest.approx(0.2)
    assert dupont["asset_turnover"] == pytest.approx(25 / 76, abs=1e-6)
    assert dupont["equity_multiplier"] == pytest.approx(380 / 235, abs=1e-6)
    assert dupont["return_on_equity"] == pytest.approx(25 / 235, abs=1e-6)


def test_finance_comps_compute_filters_outliers_and_reports_percentiles(tmp_path: Path) -> None:
    payload = run_script("finance_comps_compute.py", "comps", tmp_path)

    assert payload["ok"] is True
    metrics = payload["data"]["metrics"]

    ev_ebitda = metric_by_name(metrics, "ev_ebitda")
    pe = metric_by_name(metrics, "pe")

    assert ev_ebitda["peer_count"] == 4
    assert ev_ebitda["filtered_outliers"] == ["Peer D"]
    assert ev_ebitda["median"] == pytest.approx(9.5)
    assert ev_ebitda["subject_percentile"] == pytest.approx(50.0)

    assert pe["peer_count"] == 4
    assert pe["median"] == pytest.approx(17.5)
    assert pe["subject_percentile"] == pytest.approx(75.0)


def test_finance_dcf_compute_outputs_terminal_value_sensitivity_and_scenarios(tmp_path: Path) -> None:
    payload = run_script("finance_dcf_compute.py", "dcf", tmp_path)

    assert payload["ok"] is True
    base_case = payload["data"]["base_case"]
    sensitivity = payload["data"]["sensitivity_grid"]
    scenarios = payload["data"]["scenario_table"]

    assert base_case["terminal_value"] == pytest.approx(412.0)
    assert base_case["enterprise_value"] == pytest.approx(345.358924, abs=1e-6)
    assert sensitivity["0.10"]["0.03"] == pytest.approx(345.358924, abs=1e-6)
    assert sensitivity["0.09"]["0.04"] == pytest.approx(470.535161, abs=1e-6)
    assert scenario_by_name(scenarios, "bear")["enterprise_value"] < scenario_by_name(scenarios, "base")["enterprise_value"]
    assert scenario_by_name(scenarios, "bull")["enterprise_value"] > scenario_by_name(scenarios, "base")["enterprise_value"]


def test_finance_wacc_capm_outputs_component_breakdown(tmp_path: Path) -> None:
    payload = run_script("finance_wacc_capm.py", "wacc", tmp_path)

    assert payload["ok"] is True
    capm = payload["data"]["capm"]
    weights = payload["data"]["capital_structure"]

    assert capm["cost_of_equity"] == pytest.approx(0.1)
    assert payload["data"]["after_tax_cost_of_debt"] == pytest.approx(0.045)
    assert weights == {"equity_weight": pytest.approx(0.7), "debt_weight": pytest.approx(0.3)}
    assert payload["data"]["wacc"] == pytest.approx(0.0835)


def test_finance_technical_indicators_outputs_fixed_window_metrics(tmp_path: Path) -> None:
    payload = run_script("finance_technical_indicators.py", "technical", tmp_path)

    assert payload["ok"] is True
    indicators = payload["data"]["indicators"]

    assert indicators["sma_3"] == pytest.approx(12.666667, abs=1e-6)
    assert indicators["ema_3"] == pytest.approx(13.03125, abs=1e-6)
    assert indicators["rsi_5"] == pytest.approx(83.333333, abs=1e-6)
    assert indicators["volatility_5"] > 0


def test_finance_macro_transform_outputs_yoy_mom_zscore_and_lag(tmp_path: Path) -> None:
    payload = run_script("finance_macro_transform.py", "macro", tmp_path)

    assert payload["ok"] is True
    latest = payload["data"]["latest"]

    assert latest["yoy"] == pytest.approx(0.7)
    assert latest["mom"] == pytest.approx((170 / 165) - 1, abs=1e-6)
    assert latest["zscore"] == pytest.approx(1.414214, abs=1e-6)
    assert latest["lag_1"] == pytest.approx(165.0)


def test_finance_freshness_check_classifies_age_buckets(tmp_path: Path) -> None:
    payload = run_script("finance_freshness_check.py", "freshness", tmp_path)

    assert payload["ok"] is True
    summary = payload["data"]["summary"]
    artifacts = payload["data"]["artifacts"]

    assert summary == {"reusable": 1, "stale": 1, "suspect": 1, "missing": 1}
    assert artifact_by_name(artifacts, "issuer-model")["status"] == "reusable"
    assert artifact_by_name(artifacts, "price-snapshot")["status"] == "stale"
    assert artifact_by_name(artifacts, "macro-pack")["status"] == "suspect"
    assert artifact_by_name(artifacts, "earnings-notes")["status"] == "missing"


def test_finance_cross_source_check_flags_disagreement_and_period_misalignment(tmp_path: Path) -> None:
    payload = run_script("finance_cross_source_check.py", "cross_source", tmp_path)

    assert payload["ok"] is True
    assert payload["data"]["summary"] == {"disagreements": 1, "period_misalignments": 1, "clear": 1}
    assert payload["data"]["disagreements"][0]["metric"] == "revenue"
    assert payload["data"]["period_misalignments"][0]["metric"] == "ebitda"


def test_finance_model_validate_reports_failures_with_correction_pointers(tmp_path: Path) -> None:
    invalid_payload = run_script("finance_model_validate.py", "model_validate_invalid", tmp_path)
    valid_payload = run_script("finance_model_validate.py", "model_validate_valid", tmp_path)

    assert invalid_payload["ok"] is False
    pointers = invalid_payload["data"]["correction_pointers"]
    assert {pointer["path"] for pointer in pointers} >= {
        "model.enterprise_value",
        "model.share_count",
        "model.unit",
        "model.discount_factors",
        "model.revenue_projection",
        "model.scenario_table",
    }
    assert any(error.startswith("range:") for error in invalid_payload["errors"])
    assert any(error.startswith("reconciliation:") for error in invalid_payload["errors"])

    assert valid_payload["ok"] is True
    assert valid_payload["errors"] == []
    assert valid_payload["data"]["checks"]["passed"] >= 6
