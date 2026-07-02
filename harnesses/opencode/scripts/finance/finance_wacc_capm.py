from __future__ import annotations

from finance_common import build_envelope, parse_cli, read_json, round6, write_json


def main() -> int:
    args = parse_cli("finance_wacc_capm")
    source = read_json(args.input)

    risk_free_rate = float(source["risk_free_rate"])
    beta = float(source["beta"])
    equity_risk_premium = float(source["equity_risk_premium"])
    pre_tax_cost_of_debt = float(source["pre_tax_cost_of_debt"])
    tax_rate = float(source["tax_rate"])
    market_value_equity = float(source["market_value_equity"])
    market_value_debt = float(source["market_value_debt"])
    total_capital = market_value_equity + market_value_debt

    cost_of_equity = risk_free_rate + (beta * equity_risk_premium)
    after_tax_cost_of_debt = pre_tax_cost_of_debt * (1 - tax_rate)
    equity_weight = market_value_equity / total_capital
    debt_weight = market_value_debt / total_capital
    wacc = (equity_weight * cost_of_equity) + (debt_weight * after_tax_cost_of_debt)

    payload = build_envelope(
        script_name="finance_wacc_capm",
        source_payload=source,
        data={
            "capm": {
                "risk_free_rate": round6(risk_free_rate),
                "beta": round6(beta),
                "equity_risk_premium": round6(equity_risk_premium),
                "cost_of_equity": round6(cost_of_equity),
            },
            "after_tax_cost_of_debt": round6(after_tax_cost_of_debt),
            "capital_structure": {
                "equity_weight": round6(equity_weight),
                "debt_weight": round6(debt_weight),
            },
            "wacc": round6(wacc),
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
