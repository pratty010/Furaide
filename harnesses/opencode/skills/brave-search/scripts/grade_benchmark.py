#!/usr/bin/env python3
"""Grade brave-search benchmark runs and write quality summaries."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from quality_metrics import compute_overlap_score, compute_useful_info_per_token


ALLOWED_TOP_LEVEL_KEYS = {"query", "results"}
ALLOWED_RESULT_KEYS = {"url", "title", "content", "published_date"}


def configuration_role(configuration: str) -> str:
    for role in ("with_skill", "legacy_baseline", "tavily_reference"):
        if configuration.endswith(role):
            return role
    raise ValueError(f"Unsupported configuration: {configuration}")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def is_compact_tavily_shape(payload: dict[str, Any]) -> bool:
    if set(payload.keys()) - ALLOWED_TOP_LEVEL_KEYS:
        return False
    if not isinstance(payload.get("query"), str):
        return False
    results = payload.get("results")
    if not isinstance(results, list):
        return False
    for result in results:
        if not isinstance(result, dict):
            return False
        if set(result.keys()) - ALLOWED_RESULT_KEYS:
            return False
    return True


def result_count_ok(payload: dict[str, Any], expected_count: int) -> bool:
    return len(payload.get("results", [])) <= expected_count


def urls_and_titles_present(payload: dict[str, Any]) -> bool:
    results = payload.get("results", [])
    if not isinstance(results, list) or not results:
        return False
    for result in results:
        if not isinstance(result.get("url"), str) or not result["url"].strip():
            return False
        if not isinstance(result.get("title"), str) or not result["title"].strip():
            return False
    return True


def compute_run_metrics(
    candidate: dict[str, Any],
    normalized: dict[str, Any],
    *,
    expected_count: int,
    reference: dict[str, Any] | None,
) -> dict[str, Any]:
    candidate_json = json.dumps(candidate, separators=(",", ":"), ensure_ascii=False)
    output_chars = len(candidate_json)
    overlap_score = compute_overlap_score(normalized, reference) if reference else None
    useful_info_per_token = compute_useful_info_per_token(normalized, reference) if reference else None
    return {
        "shape_ok": is_compact_tavily_shape(candidate),
        "count_ok": result_count_ok(candidate if "results" in candidate else normalized, expected_count),
        "identity_ok": urls_and_titles_present(candidate if "results" in candidate else normalized),
        "output_chars": output_chars,
        "overlap_score": overlap_score,
        "useful_info_per_token": useful_info_per_token,
    }


def expectations_for_run(
    candidate: dict[str, Any],
    *,
    configuration: str,
    metrics: dict[str, Any],
    reference: dict[str, Any] | None,
    expected_count: int,
) -> list[dict[str, Any]]:
    role = configuration_role(configuration)
    expectations = []
    if role != "tavily_reference":
        expectations.append(
            {
                "text": "Returns compact Tavily-style JSON with query and results.",
                "passed": metrics["shape_ok"],
                "evidence": f"Top-level keys: {sorted(candidate.keys())}",
            }
        )
    expectations.extend([
        {
            "text": f"Includes no more than {expected_count} results.",
            "passed": metrics["count_ok"],
            "evidence": f"Result count: {len(candidate.get('results', [])) if isinstance(candidate.get('results'), list) else 'nested'}",
        },
        {
            "text": "Results contain non-empty URL/title pairs.",
            "passed": metrics["identity_ok"],
            "evidence": f"Checked {len(candidate.get('results', [])) if isinstance(candidate.get('results'), list) else len(reference.get('results', [])) if reference else 0} results.",
        },
    ])
    return expectations


def write_grading(run_dir: Path, expectations: list[dict[str, Any]], timing: dict[str, Any], output_chars: int) -> None:
    passed = sum(1 for item in expectations if item["passed"])
    total = len(expectations)
    failed = total - passed
    grading = {
        "expectations": expectations,
        "summary": {
            "passed": passed,
            "failed": failed,
            "total": total,
            "pass_rate": round(passed / total if total else 0.0, 4),
        },
        "execution_metrics": {
            "tool_calls": {},
            "total_tool_calls": 1,
            "total_steps": 1,
            "errors_encountered": 0,
            "output_chars": output_chars,
            "transcript_chars": 0,
        },
        "timing": timing,
        "claims": [],
        "user_notes_summary": {
            "uncertainties": [],
            "needs_review": [],
            "workarounds": [],
        },
    }
    (run_dir / "grading.json").write_text(json.dumps(grading, indent=2) + "\n")


def build_quality_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, dict[str, float]] = {}
    for row in rows:
        config = row["configuration"]
        config_summary = summary.setdefault(
            config,
            {
                "runs": 0,
                "output_tokens": 0.0,
                "overlap_score": 0.0,
                "useful_info_per_token": 0.0,
            },
        )
        config_summary["runs"] += 1
        config_summary["output_tokens"] += row["output_tokens"]
        config_summary["overlap_score"] += row.get("overlap_score") or 0.0
        config_summary["useful_info_per_token"] += row.get("useful_info_per_token") or 0.0

    for config, config_summary in summary.items():
        runs = max(1, int(config_summary["runs"]))
        config_summary["mean_output_tokens"] = round(config_summary["output_tokens"] / runs, 2)
        config_summary["mean_overlap_score"] = round(config_summary["overlap_score"] / runs, 4)
        config_summary["mean_useful_info_per_token"] = round(config_summary["useful_info_per_token"] / runs, 6)
        del config_summary["output_tokens"]
        del config_summary["overlap_score"]
        del config_summary["useful_info_per_token"]
    return summary


def markdown_summary(summary: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    lines = [
        "# Brave Search Quality Metrics",
        "",
        "## Mean by configuration",
        "",
        "| Configuration | Runs | Mean output tokens | Mean overlap score | Mean useful info / token |",
        "|---|---:|---:|---:|---:|",
    ]
    for config, values in sorted(summary.items()):
        lines.append(
            f"| {config} | {values['runs']} | {values['mean_output_tokens']:.2f} | {values['mean_overlap_score']:.4f} | {values['mean_useful_info_per_token']:.6f} |"
        )
    lines.extend(
        [
            "",
            "## Per-eval details",
            "",
            "| Eval | Configuration | Output tokens | Overlap score | Useful info / token |",
            "|---|---|---:|---:|---:|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['eval_id']} | {row['configuration']} | {row['output_tokens']} | "
            f"{'' if row.get('overlap_score') is None else f'{row['overlap_score']:.4f}'} | "
            f"{'' if row.get('useful_info_per_token') is None else f'{row['useful_info_per_token']:.6f}'} |"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Grade brave-search benchmark runs.")
    parser.add_argument("--evals", required=True)
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args()

    evals = {item["id"]: item for item in load_json(Path(args.evals))["evals"]}
    workspace = Path(args.workspace)

    rows: list[dict[str, Any]] = []

    for eval_dir in sorted(workspace.glob("eval-*")):
        metadata = load_json(eval_dir / "eval_metadata.json")
        eval_spec = evals[metadata["eval_id"]]
        reference = None
        for candidate_dir in sorted(path for path in eval_dir.iterdir() if path.is_dir()):
            if configuration_role(candidate_dir.name) == "tavily_reference":
                reference_path = candidate_dir / "run-1" / "outputs" / "normalized.json"
                if reference_path.exists():
                    reference = load_json(reference_path)
                break

        for config_dir in sorted(path for path in eval_dir.iterdir() if path.is_dir() and list(path.glob("run-*"))):
            for run_dir in sorted(config_dir.glob("run-*")):
                normalized = load_json(run_dir / "outputs" / "normalized.json")
                candidate = load_json(run_dir / "outputs" / "candidate.json")
                timing = load_json(run_dir / "timing.json")
                config_reference = reference if configuration_role(config_dir.name) != "tavily_reference" else normalized
                metrics = compute_run_metrics(
                    candidate,
                    normalized,
                    expected_count=int(eval_spec.get("count", 5)),
                    reference=config_reference,
                )
                expectations = expectations_for_run(
                    candidate,
                    configuration=config_dir.name,
                    metrics=metrics,
                    reference=config_reference,
                    expected_count=int(eval_spec.get("count", 5)),
                )
                write_grading(run_dir, expectations, timing, metrics["output_chars"])
                rows.append(
                    {
                        "eval_id": metadata["eval_id"],
                        "configuration": config_dir.name,
                        "output_tokens": timing.get("total_tokens", 0),
                        "overlap_score": metrics.get("overlap_score"),
                        "useful_info_per_token": metrics.get("useful_info_per_token"),
                    }
                )

    summary = build_quality_summary(rows)
    quality_json = {"summary": summary, "rows": rows}
    (workspace / "quality_metrics.json").write_text(json.dumps(quality_json, indent=2) + "\n")
    (workspace / "quality_metrics.md").write_text(markdown_summary(summary, rows) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
