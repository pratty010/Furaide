#!/usr/bin/env python3
"""Run a local benchmark matrix for the brave-search skill."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from normalize_results import estimate_token_count, normalize_payload


TVLY_TIME_RANGE_MAP = {
    "pd": "day",
    "pw": "week",
    "pm": "month",
    "py": "year",
}


def configuration_role(configuration: str) -> str:
    for role in ("with_skill", "legacy_baseline", "tavily_reference"):
        if configuration.endswith(role):
            return role
    raise ValueError(f"Unsupported configuration: {configuration}")


def append_bx_flag(args: list[str], flag: str, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, bool):
        if value:
            args.append(flag)
        else:
            args.extend([flag, "false"])
        return
    if isinstance(value, list):
        for item in value:
            args.extend([flag, str(item)])
        return
    args.extend([flag, str(value)])


def append_tvly_domains(args: list[str], flag: str, domains: list[str] | None) -> None:
    if domains:
        args.extend([flag, ",".join(domains)])


def map_freshness_for_tavily(freshness: str | None) -> list[str]:
    if not freshness:
        return []
    if freshness in TVLY_TIME_RANGE_MAP:
        return ["--time-range", TVLY_TIME_RANGE_MAP[freshness]]
    if "to" in freshness:
        start_date, end_date = freshness.split("to", 1)
        return ["--start-date", start_date, "--end-date", end_date]
    return []


def build_search_command(
    configuration: str,
    eval_spec: dict[str, Any],
    *,
    run_dir: Path | None = None,
    legacy_skill_name: str | None = None,
) -> list[str]:
    role = configuration_role(configuration)
    query = eval_spec["query"]
    source = eval_spec.get("source", "web")
    count = int(eval_spec.get("count", 20))

    if role == "tavily_reference":
        args = ["tvly", "search", query]
        if source == "news":
            args.extend(["--topic", "news"])
        args.extend(map_freshness_for_tavily(eval_spec.get("freshness")))
        args.extend(["--max-results", str(count)])
        append_tvly_domains(args, "--include-domains", eval_spec.get("include_domains"))
        append_tvly_domains(args, "--exclude-domains", eval_spec.get("exclude_domains"))
        if eval_spec.get("country"):
            args.extend(["--country", str(eval_spec["country"])])
        args.append("--json")
        return args

    if role == "with_skill":
        if run_dir is None:
            raise ValueError("run_dir is required for with_skill configuration")
        args = [
            "python3",
            str(Path(__file__).resolve().parent / "brave_search.py"),
            query,
            "--source",
            source,
            "--count",
            str(count),
            "--save-raw",
            str(run_dir / "outputs" / "raw.json"),
        ]
        if eval_spec.get("max_content_chars"):
            args.extend(["--max-content-chars", str(eval_spec["max_content_chars"])])
        if eval_spec.get("pretty_output"):
            args.append("--pretty")
        for field, flag in [
            ("country", "--country"),
            ("freshness", "--freshness"),
            ("search_lang", "--search-lang"),
            ("ui_lang", "--ui-lang"),
            ("offset", "--offset"),
            ("safesearch", "--safesearch"),
            ("text_decorations", "--text-decorations"),
            ("spellcheck", "--spellcheck"),
            ("operators", "--operators"),
            ("result_filter", "--result-filter"),
            ("units", "--units"),
            ("lat", "--lat"),
            ("long", "--long"),
            ("timezone", "--timezone"),
            ("city", "--city"),
            ("state", "--state"),
            ("state_name", "--state-name"),
            ("loc_country", "--loc-country"),
            ("postal_code", "--postal-code"),
        ]:
            append_bx_flag(args, flag, eval_spec.get(field))
        for domain in eval_spec.get("include_domains", []):
            args.extend(["--include-site", domain])
        for domain in eval_spec.get("exclude_domains", []):
            args.extend(["--exclude-site", domain])
        if eval_spec.get("goggles"):
            append_bx_flag(args, "--goggles", [eval_spec["goggles"]])
        append_bx_flag(args, "--extra-snippets", eval_spec.get("extra_snippets"))
        for extra in eval_spec.get("extra", []):
            args.extend(["--extra", extra])
        return args

    if role == "legacy_baseline" and legacy_skill_name == "news-search":
        source = "news"

    command = ["bx", "news" if source == "news" else "web", query]
    command.extend(["--count", str(count)])

    early_fields = [
        ("country", "--country"),
        ("freshness", "--freshness"),
    ]
    late_fields = [
        ("search_lang", "--search-lang"),
        ("ui_lang", "--ui-lang"),
        ("offset", "--offset"),
        ("safesearch", "--safesearch"),
        ("text_decorations", "--text-decorations"),
        ("spellcheck", "--spellcheck"),
        ("operators", "--operators"),
        ("goggles", "--goggles"),
        ("units", "--units"),
        ("lat", "--lat"),
        ("long", "--long"),
        ("timezone", "--timezone"),
        ("city", "--city"),
        ("state", "--state"),
        ("state_name", "--state-name"),
        ("loc_country", "--loc-country"),
        ("postal_code", "--postal-code"),
    ]
    for field, flag in early_fields:
        append_bx_flag(command, flag, eval_spec.get(field))

    for domain in eval_spec.get("include_domains", []):
        command.extend(["--include-site", domain])
    for domain in eval_spec.get("exclude_domains", []):
        command.extend(["--exclude-site", domain])

    for field, flag in late_fields:
        append_bx_flag(command, flag, eval_spec.get(field))

    if source == "web":
        append_bx_flag(command, "--result-filter", eval_spec.get("result_filter"))
    append_bx_flag(command, "--extra-snippets", eval_spec.get("extra_snippets"))

    for extra in eval_spec.get("extra", []):
        command.extend(["--extra", extra])

    return command


def run_command(command: list[str]) -> tuple[dict[str, Any], int, int]:
    started = time.time()
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(3):
        try:
            completed = subprocess.run(command, check=True, capture_output=True, text=True)
            duration_ms = int((time.time() - started) * 1000)
            payload = json.loads(completed.stdout)
            token_estimate = estimate_token_count(payload)
            return payload, duration_ms, token_estimate
        except subprocess.CalledProcessError as error:
            last_error = error
            if error.returncode not in {4, 5} or attempt == 2:
                raise
            time.sleep(1)
    assert last_error is not None
    raise last_error


def choose_candidate_payload(
    configuration: str,
    raw_payload: dict[str, Any],
    normalized: dict[str, Any],
) -> dict[str, Any]:
    if configuration_role(configuration) == "with_skill":
        return normalized
    return raw_payload


def preferred_sections(eval_spec: dict[str, Any]) -> list[str] | None:
    result_filter = eval_spec.get("result_filter")
    if not result_filter:
        return None
    sections = [item.strip() for item in str(result_filter).split(",") if item.strip()]
    return sections or None


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run brave-search benchmark matrix.")
    parser.add_argument("--evals", required=True, help="Path to evals.json")
    parser.add_argument("--workspace", required=True, help="Workspace output directory")
    parser.add_argument("--skill-name", default="brave-search")
    args = parser.parse_args()

    evals_path = Path(args.evals)
    workspace = Path(args.workspace)
    evals = json.loads(evals_path.read_text()).get("evals", [])

    for eval_spec in evals:
        eval_dir = workspace / f"eval-{eval_spec['id']}"
        save_json(
            eval_dir / "eval_metadata.json",
            {
                "eval_id": eval_spec["id"],
                "eval_name": eval_spec.get("name", f"eval-{eval_spec['id']}"),
                "prompt": eval_spec["prompt"],
                "assertions": eval_spec.get("assertions", []),
            },
        )
        for configuration in eval_spec.get("configurations", []):
            config_name = configuration["name"]
            legacy_skill_name = configuration.get("legacy_skill_name")
            run_dir = eval_dir / config_name / "run-1"
            command = build_search_command(
                config_name,
                eval_spec,
                run_dir=run_dir,
                legacy_skill_name=legacy_skill_name,
            )
            raw_payload, duration_ms, token_estimate = run_command(command)
            source_type = configuration["source_type"]
            if configuration_role(config_name) == "with_skill":
                normalized = raw_payload
                raw_path = run_dir / "outputs" / "raw.json"
                raw_payload = json.loads(raw_path.read_text()) if raw_path.exists() else normalized
            else:
                normalized = normalize_payload(
                    raw_payload,
                    source_type=source_type,
                    max_results=int(eval_spec.get("count", 20)),
                    max_content_chars=int(eval_spec.get("max_content_chars", 220)),
                    preferred_sections=preferred_sections(eval_spec),
                )
            candidate = choose_candidate_payload(config_name, raw_payload, normalized)
            candidate_token_estimate = estimate_token_count(candidate)
            if configuration_role(config_name) != "with_skill":
                save_json(run_dir / "outputs" / "raw.json", raw_payload)
            save_json(run_dir / "outputs" / "candidate.json", candidate)
            save_json(run_dir / "outputs" / "normalized.json", normalized)
            save_json(
                run_dir / "timing.json",
                {
                    "total_tokens": candidate_token_estimate,
                    "duration_ms": duration_ms,
                    "total_duration_seconds": round(duration_ms / 1000, 3),
                },
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
