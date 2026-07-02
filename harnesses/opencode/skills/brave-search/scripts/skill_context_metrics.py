#!/usr/bin/env python3
"""Estimate skill-context token costs for brave-search comparisons."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


def read_skill(skill_dir: Path) -> dict:
    skill_md = skill_dir / "SKILL.md"
    content = skill_md.read_text()
    return {
        "skill": skill_dir.name,
        "path": str(skill_md),
        "chars": len(content),
        "estimated_tokens": estimate_tokens(content),
    }


def markdown_report(rows: list[dict]) -> str:
    lines = [
        "# Skill Context Metrics",
        "",
        "| Skill | Characters | Estimated tokens |",
        "|---|---:|---:|",
    ]
    for row in rows:
        lines.append(f"| {row['skill']} | {row['chars']} | {row['estimated_tokens']} |")
    return "\n".join(lines)


def add_combined_legacy_row(rows: list[dict]) -> list[dict]:
    by_skill = {row["skill"]: row for row in rows}
    if "web-search" in by_skill and "news-search" in by_skill:
        rows.append(
            {
                "skill": "web-search + news-search",
                "path": f"{by_skill['web-search']['path']} + {by_skill['news-search']['path']}",
                "chars": by_skill["web-search"]["chars"] + by_skill["news-search"]["chars"],
                "estimated_tokens": by_skill["web-search"]["estimated_tokens"] + by_skill["news-search"]["estimated_tokens"],
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Estimate skill context token counts.")
    parser.add_argument("skill_dirs", nargs="+")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    rows = [read_skill(Path(skill_dir)) for skill_dir in args.skill_dirs]
    rows = add_combined_legacy_row(rows)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "skill_context_metrics.json").write_text(json.dumps(rows, indent=2) + "\n")
    (output_dir / "skill_context_metrics.md").write_text(markdown_report(rows) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
