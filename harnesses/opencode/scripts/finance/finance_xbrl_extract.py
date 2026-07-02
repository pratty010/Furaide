from __future__ import annotations

from finance_common import build_envelope, extract_facts, parse_cli, read_json, write_json


def main() -> int:
    args = parse_cli("finance_xbrl_extract")
    source = read_json(args.input)
    facts = extract_facts(source)
    payload = build_envelope(
        script_name="finance_xbrl_extract",
        source_payload=source,
        data={
            "entity": source.get("entity"),
            "facts": facts,
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
