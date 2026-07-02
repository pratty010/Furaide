#!/usr/bin/env python3
"""Normalize Brave and Tavily search results into a compact common shape."""

from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import math
import re
import sys
from typing import Any

TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")
SCORE_TOKEN_RE = re.compile(r"[a-z0-9]+")
_REL_RE = re.compile(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago")
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _score_tokens(text: str) -> set[str]:
    return set(SCORE_TOKEN_RE.findall((text or "").lower()))


def _relevance_score(query: str, title: str | None, content: str | None, rank_index: int, total: int) -> float:
    q = _score_tokens(query)
    if not q:
        term_overlap = 0.0
    else:
        doc = _score_tokens(f"{title or ''} {content or ''}")
        term_overlap = len(q & doc) / len(q)
    rank_prior = (total - rank_index) / total if total else 0.0
    return round(0.6 * term_overlap + 0.4 * rank_prior, 3)


def _to_iso_date(value):
    if not isinstance(value, str) or not value.strip():
        return value
    v = value.strip()
    if _ISO_RE.match(v):
        return v[:10]
    low = v.lower()
    now = _dt.datetime.now()
    if low == "yesterday":
        return (now - _dt.timedelta(days=1)).date().isoformat()
    if low == "today":
        return now.date().isoformat()
    m = _REL_RE.search(low)
    if m:
        n = int(m.group(1)); unit = m.group(2)
        days = {"second": 0, "minute": 0, "hour": 0, "day": 1, "week": 7, "month": 30, "year": 365}[unit]
        return (now - _dt.timedelta(days=n * days)).date().isoformat()
    return value


def _drop_empty(value: Any) -> Any:
    if isinstance(value, dict):
        compact = {k: _drop_empty(v) for k, v in value.items()}
        return {k: v for k, v in compact.items() if v not in ("", None, [], {}, ())}
    if isinstance(value, list):
        compact = [_drop_empty(item) for item in value]
        return [item for item in compact if item not in ("", None, [], {}, ())]
    return value


def _clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = html.unescape(TAG_RE.sub("", value))
    text = WHITESPACE_RE.sub(" ", text).strip()
    return text or None


def _truncate_text(value: str | None, max_chars: int) -> str | None:
    if not value or len(value) <= max_chars:
        return value
    truncated = value[:max_chars]
    last_sentence = -1
    for term in [". ", "! ", "? "]:
        idx = truncated.rfind(term)
        if idx >= max_chars // 2:
            last_sentence = max(last_sentence, idx + 1)
    if last_sentence > 0:
        return truncated[:last_sentence]
    clipped = truncated.rsplit(" ", 1)[0].rstrip(" ,;:")
    if not clipped:
        clipped = truncated
    return f"{clipped}…"


def _join_content(*parts: Any) -> str | None:
    seen: set[str] = set()
    items: list[str] = []
    for part in parts:
        if isinstance(part, list):
            values = part
        else:
            values = [part]
        for value in values:
            text = _clean_text(value)
            if not text:
                continue
            if text in seen:
                continue
            seen.add(text)
            items.append(text)
    return "\n".join(items) if items else None


def _normalize_result(
    result: dict[str, Any],
    *,
    source_type: str,
    max_content_chars: int,
) -> dict[str, Any]:
    if source_type == "tvly":
        normalized = {
            "url": result.get("url"),
            "title": _clean_text(result.get("title")),
            "content": _truncate_text(_join_content(result.get("content")), max_content_chars),
            "published_date": _to_iso_date(result.get("published_date")),
        }
        return _drop_empty(normalized)

    normalized = {
        "url": result.get("url"),
        "title": _clean_text(result.get("title")),
        "content": _truncate_text(
            _join_content(result.get("description"), result.get("content"), result.get("extra_snippets")),
            max_content_chars,
        ),
        "published_date": _to_iso_date(result.get("page_age") or result.get("published_date")),
    }
    return _drop_empty(normalized)


def _bx_web_results(payload: dict[str, Any], preferred_sections: list[str] | None) -> list[dict[str, Any]]:
    default_sections = ["web", "discussions", "faq", "news", "videos", "locations"]
    ordered_sections = preferred_sections or default_sections
    collected: list[dict[str, Any]] = []

    for section in ordered_sections:
        bucket = payload.get(section)
        if isinstance(bucket, dict) and isinstance(bucket.get("results"), list):
            collected.extend(item for item in bucket["results"] if isinstance(item, dict))

    if collected or not preferred_sections:
        return collected

    for section in default_sections:
        if section in ordered_sections:
            continue
        bucket = payload.get(section)
        if isinstance(bucket, dict) and isinstance(bucket.get("results"), list):
            collected.extend(item for item in bucket["results"] if isinstance(item, dict))
    return collected


def normalize_payload(
    payload: dict[str, Any],
    *,
    source_type: str,
    max_results: int = 20,
    max_content_chars: int = 220,
    preferred_sections: list[str] | None = None,
) -> dict[str, Any]:
    if source_type == "bx_web":
        query = payload.get("query", {}).get("original") or payload.get("query", {}).get("cleaned") or ""
        results = _bx_web_results(payload, preferred_sections)
    elif source_type == "bx_news":
        query = payload.get("query", {}).get("original") or payload.get("query", {}).get("cleaned") or ""
        results = payload.get("results", [])
    elif source_type == "tvly":
        query = payload.get("query", "")
        results = payload.get("results", [])
    else:
        raise ValueError(f"Unsupported source_type: {source_type}")

    normalized_results = []
    for result in results:
        normalized = _normalize_result(result, source_type=source_type, max_content_chars=max_content_chars)
        if not normalized.get("url") or not normalized.get("title"):
            continue
        normalized_results.append(normalized)
        if len(normalized_results) >= max_results:
            break

    total = len(normalized_results)
    for i, r in enumerate(normalized_results):
        r["score"] = _relevance_score(query, r.get("title"), r.get("content"), i, total)

    normalized_results.sort(key=lambda r: r.get("score", 0.0), reverse=True)

    return {
        "query": query,
        "results": normalized_results,
    }


def estimate_token_count(payload: dict[str, Any]) -> int:
    serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return max(1, math.ceil(len(serialized) / 4))


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize Brave or Tavily search results.")
    parser.add_argument("--source-type", required=True, choices=["bx_web", "bx_news", "tvly"])
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--max-content-chars", type=int, default=220)
    args = parser.parse_args()

    payload = json.load(sys.stdin)
    normalized = normalize_payload(
        payload,
        source_type=args.source_type,
        max_results=args.max_results,
        max_content_chars=args.max_content_chars,
    )
    json.dump(normalized, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
