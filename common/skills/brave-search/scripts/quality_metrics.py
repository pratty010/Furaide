#!/usr/bin/env python3
"""Compact quality metrics for comparing normalized search outputs."""

from __future__ import annotations

import json
import math
import re
from typing import Any


TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> set[str]:
    return set(TOKEN_RE.findall(text.lower()))


def _result_text(payload: dict[str, Any], field: str) -> str:
    values: list[str] = []
    for result in payload.get("results", []):
        value = result.get(field)
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    return "\n".join(values)


def compute_overlap_score(candidate: dict[str, Any], reference: dict[str, Any]) -> float:
    candidate_urls = {result.get("url") for result in candidate.get("results", []) if result.get("url")}
    reference_urls = {result.get("url") for result in reference.get("results", []) if result.get("url")}
    url_overlap = len(candidate_urls & reference_urls) / max(1, len(reference_urls))

    candidate_title_tokens = _tokenize(_result_text(candidate, "title"))
    reference_title_tokens = _tokenize(_result_text(reference, "title"))
    title_overlap = len(candidate_title_tokens & reference_title_tokens) / max(1, len(reference_title_tokens))

    candidate_content_tokens = _tokenize(_result_text(candidate, "content"))
    reference_content_tokens = _tokenize(_result_text(reference, "content"))
    content_overlap = len(candidate_content_tokens & reference_content_tokens) / max(1, len(reference_content_tokens))

    return round((0.5 * url_overlap) + (0.3 * title_overlap) + (0.2 * content_overlap), 4)


def compute_useful_info_per_token(candidate: dict[str, Any], reference: dict[str, Any]) -> float:
    compact_json = json.dumps(candidate, separators=(",", ":"), ensure_ascii=False)
    estimated_tokens = max(1, math.ceil(len(compact_json) / 4))
    overlap_score = compute_overlap_score(candidate, reference)
    return round(overlap_score / estimated_tokens, 6)
