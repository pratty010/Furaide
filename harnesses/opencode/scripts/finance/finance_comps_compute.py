from __future__ import annotations

import statistics

from finance_common import build_envelope, iqr_bounds, parse_cli, percentile_rank, read_json, round6, write_json


def filter_metric_peers(peers: list[dict], metric_name: str) -> tuple[list[dict], list[str]]:
    metric_peers = [peer for peer in peers if metric_name in peer.get("metrics", {})]
    values = [float(peer["metrics"][metric_name]) for peer in metric_peers]
    if len(values) < 4:
        return metric_peers, []
    lower, upper = iqr_bounds(values)
    kept = [peer for peer in metric_peers if lower <= float(peer["metrics"][metric_name]) <= upper]
    removed = [peer["name"] for peer in metric_peers if peer not in kept]
    return kept, removed


def main() -> int:
    args = parse_cli("finance_comps_compute")
    source = read_json(args.input)
    subject = source.get("subject", {})
    peers = source.get("peers", [])

    metrics = []
    for metric_name, subject_value in subject.get("metrics", {}).items():
        filtered_peers, removed = filter_metric_peers(peers, metric_name)
        filtered_values = [float(peer["metrics"][metric_name]) for peer in filtered_peers]
        metrics.append(
            {
                "name": metric_name,
                "subject_value": float(subject_value),
                "peer_count": len(filtered_values),
                "median": round6(statistics.median(filtered_values)) if filtered_values else None,
                "subject_percentile": round6(percentile_rank(filtered_values, float(subject_value))),
                "filtered_outliers": removed,
                "peer_values": filtered_values,
            }
        )

    payload = build_envelope(
        script_name="finance_comps_compute",
        source_payload=source,
        data={
            "subject": subject.get("name"),
            "metrics": metrics,
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
