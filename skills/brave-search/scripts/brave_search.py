#!/usr/bin/env python3
"""Wrapper around bx web/news that emits compact Tavily-style JSON."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from normalize_results import normalize_payload

TRANSIENT_EXIT_CODES = {4, 5}
NEWS_RE = re.compile(r"\b(news|headlines?|breaking|coverage|articles?|reporting|report|today|current events|latest|updates?|released?|announce(?:ment|d)?|recently|this week|this month|live|developments)\b")


def bool_arg(value: str | None) -> str | None:
    if value is None:
        return None
    lowered = value.lower()
    if lowered not in {"true", "false"}:
        raise argparse.ArgumentTypeError("expected true or false")
    return lowered


def append_flag(command: list[str], flag: str, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, list):
        for item in value:
            command.extend([flag, str(item)])
        return
    command.extend([flag, str(value)])


def infer_source(query: str) -> str:
    return "news" if NEWS_RE.search(query.lower()) else "web"


def source_type_for(source: str) -> str:
    return "bx_news" if source == "news" else "bx_web"


def preferred_sections(result_filter: str | None) -> list[str] | None:
    if not result_filter:
        return None
    sections = [item.strip() for item in result_filter.split(",") if item.strip()]
    return sections or None


def build_bx_command(args: argparse.Namespace, source: str) -> list[str]:
    command = ["bx", "news" if source == "news" else "web", args.query, "--count", str(args.count)]

    shared_fields = [
        ("config", "--config"),
        ("country", "--country"),
        ("api_key", "--api-key"),
        ("search_lang", "--search-lang"),
        ("base_url", "--base-url"),
        ("ui_lang", "--ui-lang"),
        ("timeout", "--timeout"),
        ("offset", "--offset"),
        ("endpoint", "--endpoint"),
        ("safesearch", "--safesearch"),
        ("freshness", "--freshness"),
        ("spellcheck", "--spellcheck"),
        ("extra_snippets", "--extra-snippets"),
        ("operators", "--operators"),
    ]
    for field, flag in shared_fields:
        append_flag(command, flag, getattr(args, field))

    if args.goggles:
        append_flag(command, "--goggles", args.goggles)
    else:
        append_flag(command, "--include-site", args.include_site)
        append_flag(command, "--exclude-site", args.exclude_site)

    if source == "web":
        append_flag(command, "--text-decorations", args.text_decorations)
        append_flag(command, "--result-filter", args.result_filter or "web")
        append_flag(command, "--units", args.units)
        append_flag(command, "--lat", args.lat)
        append_flag(command, "--long", args.long)
        append_flag(command, "--timezone", args.timezone)
        append_flag(command, "--city", args.city)
        append_flag(command, "--state", args.state)
        append_flag(command, "--state-name", args.state_name)
        append_flag(command, "--loc-country", args.loc_country)
        append_flag(command, "--postal-code", args.postal_code)

    append_flag(command, "--extra", args.extra)
    return command


def run_json_command(command: list[str]) -> dict[str, Any]:
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(3):
        try:
            completed = subprocess.run(command, check=True, capture_output=True, text=True)
            return json.loads(completed.stdout)
        except subprocess.CalledProcessError as error:
            last_error = error
            if error.returncode not in TRANSIENT_EXIT_CODES or attempt == 2:
                stderr = error.stderr.strip() if error.stderr else str(error)
                raise RuntimeError(f"{' '.join(command[:2])} failed: {stderr}") from error
            time.sleep(1)
    assert last_error is not None
    raise RuntimeError(str(last_error))


def save_json(path: str | None, payload: dict[str, Any], *, pretty: bool) -> None:
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, indent=2 if pretty else None, separators=None if pretty else (",", ":"), ensure_ascii=False)
        + "\n"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Brave search and emit compact Tavily-style JSON.")
    parser.add_argument("query")
    parser.add_argument("--source", choices=["auto", "web", "news"], default="auto")
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--max-results", dest="count", type=int, default=argparse.SUPPRESS, help="Alias for --count")
    parser.add_argument("--max-content-chars", type=int, default=220)
    parser.add_argument("--pretty", dest="pretty", action="store_true", help="Pretty-print indented JSON output (default).")
    parser.add_argument("--compact", dest="pretty", action="store_false", help="Emit minified JSON.")
    parser.set_defaults(pretty=True)
    parser.add_argument("--output", choices=["normalized", "raw"], default="normalized")
    parser.add_argument("--save-raw")
    parser.add_argument("--config")
    parser.add_argument("--country")
    parser.add_argument("--api-key", dest="api_key")
    parser.add_argument("--search-lang", dest="search_lang")
    parser.add_argument("--base-url", dest="base_url")
    parser.add_argument("--ui-lang", dest="ui_lang")
    parser.add_argument("--timeout", type=int)
    parser.add_argument("--extra", action="append", default=[])
    parser.add_argument("--offset", type=int)
    parser.add_argument("--endpoint")
    parser.add_argument("--safesearch", choices=["off", "moderate", "strict"])
    parser.add_argument("--freshness")
    parser.add_argument("--spellcheck", type=bool_arg)
    parser.add_argument("--extra-snippets", dest="extra_snippets", type=bool_arg, default="false")
    parser.add_argument("--goggles", action="append")
    parser.add_argument("--include-site", dest="include_site", action="append", default=[])
    parser.add_argument("--exclude-site", dest="exclude_site", action="append", default=[])
    parser.add_argument("--operators", type=bool_arg)
    parser.add_argument("--text-decorations", dest="text_decorations", type=bool_arg, default="false")
    parser.add_argument("--result-filter")
    parser.add_argument("--units", choices=["metric", "imperial"])
    parser.add_argument("--lat", type=float)
    parser.add_argument("--long", type=float)
    parser.add_argument("--timezone")
    parser.add_argument("--city")
    parser.add_argument("--state")
    parser.add_argument("--state-name", dest="state_name")
    parser.add_argument("--loc-country", dest="loc_country")
    parser.add_argument("--postal-code", dest="postal_code")
    parser.add_argument("--min-score", type=float, default=0.0)
    parser.add_argument("--top", type=int)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    def _split_csv(values):
        out = []
        for v in values or []:
            out.extend(part.strip() for part in str(v).split(",") if part.strip())
        return out
    args.include_site = _split_csv(args.include_site)
    args.exclude_site = _split_csv(args.exclude_site)

    source = args.source if args.source != "auto" else infer_source(args.query)
    raw_payload = run_json_command(build_bx_command(args, source))
    save_json(args.save_raw, raw_payload, pretty=args.pretty)

    if args.output == "raw":
        payload = raw_payload
    else:
        payload = normalize_payload(
            raw_payload,
            source_type=source_type_for(source),
            max_results=args.count,
            max_content_chars=args.max_content_chars,
            preferred_sections=preferred_sections(args.result_filter),
        )
        if not payload.get("query"):
            payload["query"] = args.query

        if args.min_score > 0.0:
            payload["results"] = [r for r in payload["results"] if r.get("score", 0.0) >= args.min_score]
        if args.top:
            payload["results"] = payload["results"][: args.top]

    json.dump(payload, sys.stdout, indent=2 if args.pretty else None, separators=None if args.pretty else (",", ":"), ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
