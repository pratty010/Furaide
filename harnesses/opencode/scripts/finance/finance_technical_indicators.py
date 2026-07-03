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


def sma(values: list[float], window: int) -> float:
    segment = trailing_window(values, window)
    return sum(segment) / len(segment)


def ema(values: list[float], window: int) -> float:
    alpha = 2 / (window + 1)
    current = values[0]
    for value in values[1:]:
        current = (alpha * value) + ((1 - alpha) * current)
    return current


def rsi(values: list[float], window: int) -> float:
    deltas = [current - previous for previous, current in zip(values[:-1], values[1:])]
    segment = trailing_window(deltas, window)
    gains = [delta for delta in segment if delta > 0]
    losses = [abs(delta) for delta in segment if delta < 0]
    average_gain = sum(gains) / window if window else 0.0
    average_loss = sum(losses) / window if window else 0.0
    if average_loss == 0:
        return 100.0
    relative_strength = average_gain / average_loss
    return 100 - (100 / (1 + relative_strength))


def main() -> int:
    args = parse_cli("finance_technical_indicators")
    source = read_json(args.input)
    closes = [float(row["close"]) for row in source.get("prices", [])]
    windows = source.get("windows", {})
    volatility_window = int(windows.get("volatility", 5))
    return_window = trailing_window(closes, volatility_window)
    returns = [((current / previous) - 1) for previous, current in zip(return_window[:-1], return_window[1:])]

    payload = build_envelope(
        script_name="finance_technical_indicators",
        source_payload=source,
        data={
            "as_of": source.get("prices", [])[-1]["date"] if source.get("prices") else None,
            "indicators": {
                f"sma_{int(windows.get('sma', 3))}": round6(sma(closes, int(windows.get("sma", 3)))),
                f"ema_{int(windows.get('ema', 3))}": round6(ema(closes, int(windows.get("ema", 3)))),
                f"rsi_{int(windows.get('rsi', 5))}": round6(rsi(closes, int(windows.get("rsi", 5)))),
                f"volatility_{volatility_window}": round6(population_std(returns)),
            },
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(run_main(main))
