from __future__ import annotations

from finance_common import (
    ROW_LABELS,
    STATEMENT_MAP,
    build_envelope,
    extract_facts,
    parse_cli,
    parse_unit_token,
    read_json,
    run_main,
    write_json,
)


def main() -> int:
    args = parse_cli("finance_statement_normalize")
    source = read_json(args.input)
    statements = {
        "income_statement": [],
        "balance_sheet": [],
        "cash_flow": [],
    }

    for fact in extract_facts(source):
        statement = STATEMENT_MAP.get(fact["canonical_concept"], fact["statement"])
        unit_meta = parse_unit_token(fact["unit"])
        row = {
            "statement": statement,
            "row_code": fact["canonical_concept"],
            "label": ROW_LABELS.get(fact["canonical_concept"], fact["label"]),
            "value": fact["value"],
            "unit": fact["unit"],
            "scale": unit_meta["scale"],
            "sign": -1 if fact["value"] < 0 else 1,
            "source_tag": "xbrl_fact",
            "source_concept": fact["source_concept"],
            "context": fact["context"],
            "period": fact["period"],
        }
        if statement in statements:
            statements[statement].append(row)

    payload = build_envelope(
        script_name="finance_statement_normalize",
        source_payload=source,
        data={"statements": statements},
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(run_main(main))
