from __future__ import annotations

from finance_common import (
    build_envelope,
    parse_cli,
    population_std,
    read_json,
    round6,
    run_main,
    trailing_window,
    write_json,
)


def main() -> int:
    args = parse_cli("finance_macro_transform")
    source = read_json(args.input)
    series = source.get("series", [])
    zscore_window = int(source.get("zscore_window", 5))
    lag_periods = int(source.get("lag_periods", 1))
    transformed = []

    for index, row in enumerate(series):
        value = float(row["value"])
        mom = None
        yoy = None
        lag_value = None
        zscore = None

        if index >= 1:
            previous = float(series[index - 1]["value"])
            mom = (value / previous) - 1 if previous else None
        if index >= 12:
            prior_year = float(series[index - 12]["value"])
            yoy = (value / prior_year) - 1 if prior_year else None
        if index >= lag_periods:
            lag_value = float(series[index - lag_periods]["value"])
        if index + 1 >= zscore_window:
            window_values = [float(item["value"]) for item in trailing_window(series[: index + 1], zscore_window)]
            mean = sum(window_values) / len(window_values)
            std_dev = population_std(window_values)
            zscore = 0.0 if std_dev == 0 else (value - mean) / std_dev

        transformed.append(
            {
                "date": row["date"],
                "value": value,
                "mom": round6(mom),
                "yoy": round6(yoy),
                f"lag_{lag_periods}": round6(lag_value),
                "zscore": round6(zscore),
            }
        )

    payload = build_envelope(
        script_name="finance_macro_transform",
        source_payload=source,
        data={
            "series": transformed,
            "latest": transformed[-1] if transformed else {},
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(run_main(main))
