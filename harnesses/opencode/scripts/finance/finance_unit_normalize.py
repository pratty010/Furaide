from __future__ import annotations

from finance_common import (
    BASE_CURRENCY,
    build_envelope,
    extract_facts,
    find_fx_rate,
    parse_cli,
    parse_unit_token,
    read_json,
    write_json,
)


def main() -> int:
    args = parse_cli("finance_unit_normalize")
    source = read_json(args.input)
    normalized_facts = []

    for fact in extract_facts(source):
        unit_meta = parse_unit_token(fact["unit"])
        normalized_value = float(fact["value"]) * float(unit_meta["multiplier"])
        normalized_unit = unit_meta["base_unit"]
        fx_rate = None
        fx_timestamp = None

        if unit_meta["measurement"] == "currency" and unit_meta["currency"] != BASE_CURRENCY:
            fx_rate, fx_timestamp = find_fx_rate(source, unit_meta["currency"], BASE_CURRENCY)
            if fx_rate is not None:
                normalized_value *= fx_rate
                normalized_unit = BASE_CURRENCY

        normalized_facts.append(
            {
                **fact,
                "measurement": unit_meta["measurement"],
                "scale": unit_meta["scale"],
                "currency": unit_meta["currency"],
                "normalized_value": normalized_value,
                "normalized_unit": normalized_unit,
                "fx_rate": fx_rate,
                "fx_timestamp": fx_timestamp,
            }
        )

    payload = build_envelope(
        script_name="finance_unit_normalize",
        source_payload=source,
        data={"normalized_facts": normalized_facts},
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
