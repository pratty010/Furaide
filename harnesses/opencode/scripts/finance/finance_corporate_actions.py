from __future__ import annotations

from finance_common import (
    PER_SHARE_CONCEPTS,
    SHARE_COUNT_CONCEPTS,
    build_envelope,
    extract_facts,
    parse_cli,
    read_json,
    run_main,
    write_json,
)


def period_end(fact: dict) -> str:
    return fact.get("period", {}).get("end", "")


def main() -> int:
    args = parse_cli("finance_corporate_actions")
    source = read_json(args.input)
    split_actions = [action for action in source.get("corporate_actions", []) if action.get("type") == "split"]
    dividend_metadata = [
        {
            "cash_dividend_per_share": action["cash_dividend_per_share"],
            "currency": action["currency"],
            "effective_date": action["effective_date"],
            "type": "dividend",
        }
        for action in source.get("corporate_actions", [])
        if action.get("type") == "dividend"
    ]

    adjusted_facts = []
    for fact in extract_facts(source):
        adjusted_value = float(fact["value"])
        factor = 1.0
        applied = []

        for action in split_actions:
            applies_to = set(action.get("applies_to", []))
            if fact["canonical_concept"] not in applies_to:
                continue
            if period_end(fact) >= action.get("effective_date", ""):
                continue

            ratio = float(action["ratio"])
            if fact["canonical_concept"] in SHARE_COUNT_CONCEPTS:
                adjusted_value *= ratio
                factor *= ratio
            elif fact["canonical_concept"] in PER_SHARE_CONCEPTS:
                adjusted_value /= ratio
                factor /= ratio
            applied.append(
                {
                    "type": "split",
                    "ratio": ratio,
                    "effective_date": action["effective_date"],
                }
            )

        adjusted_facts.append(
            {
                **fact,
                "adjusted_value": adjusted_value,
                "adjustment_factor": factor,
                "adjustments_applied": applied,
            }
        )

    payload = build_envelope(
        script_name="finance_corporate_actions",
        source_payload=source,
        data={
            "adjusted_facts": adjusted_facts,
            "dividend_metadata": dividend_metadata,
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(run_main(main))
