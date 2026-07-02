from __future__ import annotations

from finance_common import build_envelope, parse_cli, read_json, round6, write_json


def add_issue(errors: list[str], pointers: list[dict], prefix: str, path: str, message: str) -> None:
    errors.append(f"{prefix}:{message}")
    pointers.append({"path": path, "issue": f"{prefix}:{message}"})


def main() -> int:
    args = parse_cli("finance_model_validate")
    source = read_json(args.input)
    model = source.get("model", {})
    errors: list[str] = []
    pointers: list[dict] = []
    passed = 0

    required_fields = [
        "enterprise_value",
        "equity_value",
        "net_debt",
        "share_count",
        "diluted_share_count",
        "unit",
        "discount_factors",
        "revenue_projection",
        "scenario_table",
    ]
    missing = [field for field in required_fields if field not in model]
    if missing:
        for field in missing:
            add_issue(errors, pointers, "schema", f"model.{field}", "missing required field")
    else:
        passed += 1

    enterprise_value = float(model.get("enterprise_value", 0.0))
    if enterprise_value <= 0:
        add_issue(errors, pointers, "range", "model.enterprise_value", "must be positive")
    else:
        passed += 1

    share_count = float(model.get("share_count", 0.0))
    diluted_share_count = float(model.get("diluted_share_count", 0.0))
    if share_count <= 0:
        add_issue(errors, pointers, "share_count", "model.share_count", "must be positive")
    elif diluted_share_count < share_count:
        add_issue(errors, pointers, "share_count", "model.diluted_share_count", "cannot be less than share_count")
    else:
        passed += 1

    expected_unit = source.get("expected_unit")
    if model.get("unit") != expected_unit:
        add_issue(errors, pointers, "unit", "model.unit", f"expected {expected_unit}")
    else:
        passed += 1

    discount_factors = [float(value) for value in model.get("discount_factors", [])]
    if any(current >= previous for previous, current in zip(discount_factors, discount_factors[1:])):
        add_issue(errors, pointers, "monotonicity", "model.discount_factors", "must strictly decrease")
    else:
        passed += 1

    revenue_projection = [float(value) for value in model.get("revenue_projection", [])]
    if any(current < previous for previous, current in zip(revenue_projection, revenue_projection[1:])):
        add_issue(errors, pointers, "monotonicity", "model.revenue_projection", "must be non-decreasing")
    else:
        passed += 1

    if not model.get("scenario_table"):
        add_issue(errors, pointers, "schema", "model.scenario_table", "must contain at least one scenario")
    else:
        passed += 1

    expected_equity_value = float(model.get("enterprise_value", 0.0)) - float(model.get("net_debt", 0.0))
    if abs(expected_equity_value - float(model.get("equity_value", 0.0))) > 1e-6:
        add_issue(errors, pointers, "reconciliation", "model.equity_value", "must equal enterprise_value minus net_debt")
    else:
        passed += 1

    payload = build_envelope(
        script_name="finance_model_validate",
        source_payload=source,
        data={
            "checks": {
                "passed": passed,
                "failed": len(errors),
            },
            "correction_pointers": pointers,
            "expected_equity_value": round6(expected_equity_value),
        },
        errors=errors,
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
