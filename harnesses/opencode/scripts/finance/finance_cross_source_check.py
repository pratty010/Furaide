from __future__ import annotations

from finance_common import (
    build_envelope,
    parse_cli,
    read_json,
    relative_difference,
    round6,
    run_main,
    write_json,
)


def main() -> int:
    args = parse_cli("finance_cross_source_check")
    source = read_json(args.input)
    threshold = float(source.get("materiality_threshold", 0.1))

    disagreements = []
    period_misalignments = []
    clear = []

    for metric in source.get("metrics", []):
        observations = metric.get("observations", [])
        periods = sorted({item.get("period") for item in observations})
        values = [float(item["value"]) for item in observations if "value" in item]
        if len(periods) > 1:
            period_misalignments.append({"metric": metric["metric"], "periods": periods, "observations": observations})
            continue

        difference = relative_difference(values)
        if difference > threshold:
            disagreements.append(
                {
                    "metric": metric["metric"],
                    "period": periods[0] if periods else None,
                    "relative_difference": round6(difference),
                    "observations": observations,
                }
            )
        else:
            clear.append({"metric": metric["metric"], "period": periods[0] if periods else None})

    payload = build_envelope(
        script_name="finance_cross_source_check",
        source_payload=source,
        data={
            "summary": {
                "disagreements": len(disagreements),
                "period_misalignments": len(period_misalignments),
                "clear": len(clear),
            },
            "disagreements": disagreements,
            "period_misalignments": period_misalignments,
            "clear": clear,
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(run_main(main))
