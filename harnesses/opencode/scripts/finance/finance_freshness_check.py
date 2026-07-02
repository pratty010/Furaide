from __future__ import annotations

from finance_common import age_in_days, build_envelope, parse_cli, read_json, round6, write_json


def classify_artifact(artifact: dict, now: str, threshold_days: dict[str, float]) -> dict:
    if not artifact.get("retrieved_at"):
        return {**artifact, "status": "missing", "reason": "missing_retrieved_at", "age_days": None}
    age_days = age_in_days(now, artifact["retrieved_at"])
    if age_days is None:
        return {**artifact, "status": "suspect", "reason": "invalid_timestamp", "age_days": None}
    if age_days < 0:
        return {**artifact, "status": "suspect", "reason": "future_timestamp", "age_days": round6(age_days)}

    threshold = threshold_days.get(artifact.get("source_class", ""))
    if threshold is None:
        return {**artifact, "status": "suspect", "reason": "missing_threshold", "age_days": round6(age_days)}
    if age_days > float(threshold):
        return {**artifact, "status": "stale", "reason": f"older_than_{threshold}_days", "age_days": round6(age_days)}
    return {**artifact, "status": "reusable", "reason": "within_threshold", "age_days": round6(age_days)}


def main() -> int:
    args = parse_cli("finance_freshness_check")
    source = read_json(args.input)
    now = source.get("now") or source.get("retrieved")
    threshold_days = {key: float(value) for key, value in source.get("threshold_days", {}).items()}
    artifacts = [classify_artifact(artifact, now, threshold_days) for artifact in source.get("artifacts", [])]

    summary = {"reusable": 0, "stale": 0, "suspect": 0, "missing": 0}
    for artifact in artifacts:
        summary[artifact["status"]] += 1

    payload = build_envelope(
        script_name="finance_freshness_check",
        source_payload=source,
        data={
            "evaluated_at": now,
            "artifacts": artifacts,
            "summary": summary,
        },
    )
    write_json(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
