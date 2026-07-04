from __future__ import annotations

from finance_common import (
    average_of_present,
    build_envelope,
    parse_cli,
    read_json,
    round6,
    run_main,
    safe_divide,
    write_json,
)


def ratio_entry(name: str, numerator_code: str, denominator_code: str, numerator: float, denominator: float) -> dict:
    return {
        "name": name,
        "value": round6(safe_divide(numerator, denominator)),
        "definition": {
            "numerator": numerator_code,
            "denominator": denominator_code,
        },
    }


def main() -> int:
    args = parse_cli("finance_ratio_compute")
    source = read_json(args.input)
    current = source.get("current", {})
    prior = source.get("prior", {})

    average_assets = average_of_present(current.get("assets"), prior.get("assets"))
    average_equity = average_of_present(current.get("equity"), prior.get("equity"))
    free_cash_flow = float(current.get("cash_from_operations", 0.0)) + float(current.get("capital_expenditures", 0.0))

    ratios = [
        ratio_entry("net_margin", "net_income", "revenue", float(current.get("net_income", 0.0)), float(current.get("revenue", 0.0))),
        ratio_entry("asset_turnover", "revenue", "average_assets", float(current.get("revenue", 0.0)), average_assets),
        ratio_entry("equity_multiplier", "average_assets", "average_equity", average_assets, average_equity),
        ratio_entry("return_on_assets", "net_income", "average_assets", float(current.get("net_income", 0.0)), average_assets),
        ratio_entry("return_on_equity", "net_income", "average_equity", float(current.get("net_income", 0.0)), average_equity),
        ratio_entry("debt_to_equity", "liabilities", "equity", float(current.get("liabilities", 0.0)), float(current.get("equity", 0.0))),
        ratio_entry("free_cash_flow_margin", "free_cash_flow", "revenue", free_cash_flow, float(current.get("revenue", 0.0))),
    ]

    metrics_by_name = {entry["name"]: entry["value"] for entry in ratios}
    payload = build_envelope(
        script_name="finance_ratio_compute",
        source_payload=source,
        data={
            "period": source.get("period"),
            "averages": {
                "average_assets": round6(average_assets),
                "average_equity": round6(average_equity),
                "free_cash_flow": round6(free_cash_flow),
            },
            "ratios": ratios,
            "dupont": {
                "net_margin": metrics_by_name["net_margin"],
                "asset_turnover": metrics_by_name["asset_turnover"],
                "equity_multiplier": metrics_by_name["equity_multiplier"],
                "return_on_equity": metrics_by_name["return_on_equity"],
            },
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(run_main(main))
