from __future__ import annotations

from finance_common import build_envelope, parse_cli, read_json, round6, write_json


def dcf_case(fcff: list[float], wacc: float, terminal_growth: float) -> dict:
    discounted_cash_flows = [float(cash_flow) / ((1 + wacc) ** index) for index, cash_flow in enumerate(fcff, start=1)]
    terminal_value = float(fcff[-1]) * (1 + terminal_growth) / (wacc - terminal_growth)
    discounted_terminal_value = terminal_value / ((1 + wacc) ** len(fcff))
    enterprise_value = sum(discounted_cash_flows) + discounted_terminal_value
    return {
        "fcff": [float(value) for value in fcff],
        "wacc": round6(wacc),
        "terminal_growth": round6(terminal_growth),
        "discounted_cash_flows": [round6(value) for value in discounted_cash_flows],
        "terminal_value": round6(terminal_value),
        "discounted_terminal_value": round6(discounted_terminal_value),
        "enterprise_value": round6(enterprise_value),
    }


def main() -> int:
    args = parse_cli("finance_dcf_compute")
    source = read_json(args.input)
    base = source["base_case"]
    base_case = dcf_case(base["fcff"], float(base["wacc"]), float(base["terminal_growth"]))

    sensitivity_grid = {}
    for wacc in source.get("sensitivity", {}).get("wacc", []):
        wacc_key = f"{float(wacc):.2f}"
        sensitivity_grid[wacc_key] = {}
        for terminal_growth in source.get("sensitivity", {}).get("terminal_growth", []):
            growth_key = f"{float(terminal_growth):.2f}"
            sensitivity_grid[wacc_key][growth_key] = round6(
                dcf_case(base["fcff"], float(wacc), float(terminal_growth))["enterprise_value"]
            )

    scenario_table = []
    for scenario in source.get("scenarios", []):
        scenario_result = dcf_case(scenario["fcff"], float(scenario["wacc"]), float(scenario["terminal_growth"]))
        scenario_table.append({"name": scenario["name"], **scenario_result})

    payload = build_envelope(
        script_name="finance_dcf_compute",
        source_payload=source,
        data={
            "base_case": base_case,
            "sensitivity_grid": sensitivity_grid,
            "scenario_table": scenario_table,
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
