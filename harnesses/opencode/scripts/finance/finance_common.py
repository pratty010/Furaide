from __future__ import annotations

import argparse
import json
import math
import statistics
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


VERSION = "0.1.0"
BASE_CURRENCY = "USD"

CONCEPT_ALIASES = {
    "RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
    "Revenues": "revenue",
    "NetIncomeLoss": "net_income",
    "Assets": "assets",
    "Liabilities": "liabilities",
    "StockholdersEquity": "equity",
    "NetCashProvidedByUsedInOperatingActivities": "cash_from_operations",
    "PaymentsToAcquirePropertyPlantAndEquipment": "capital_expenditures",
    "EarningsPerShareBasic": "eps_basic",
    "CommonStockSharesOutstanding": "shares_outstanding",
    "CashAndCashEquivalentsAtCarryingValue": "cash_and_cash_equivalents",
}

ROW_LABELS = {
    "revenue": "Revenue",
    "net_income": "Net income",
    "assets": "Assets",
    "liabilities": "Liabilities",
    "equity": "Equity",
    "cash_from_operations": "Cash from operations",
    "capital_expenditures": "Capital expenditures",
    "eps_basic": "Basic EPS",
    "shares_outstanding": "Shares outstanding",
    "cash_and_cash_equivalents": "Cash and cash equivalents",
}

STATEMENT_MAP = {
    "revenue": "income_statement",
    "net_income": "income_statement",
    "eps_basic": "income_statement",
    "assets": "balance_sheet",
    "liabilities": "balance_sheet",
    "equity": "balance_sheet",
    "shares_outstanding": "balance_sheet",
    "cash_and_cash_equivalents": "balance_sheet",
    "cash_from_operations": "cash_flow",
    "capital_expenditures": "cash_flow",
}

SHARE_COUNT_CONCEPTS = {"shares_outstanding"}
PER_SHARE_CONCEPTS = {"eps_basic"}

SCALE_FACTORS = {
    "unit": 1.0,
    "thousand": 1_000.0,
    "million": 1_000_000.0,
    "billion": 1_000_000_000.0,
}


class Provenance(BaseModel):
    source_ids: list[str] = Field(default_factory=list)
    retrieved: str | None = None
    script: str
    version: str = VERSION


class Envelope(BaseModel):
    ok: bool
    data: dict[str, Any] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    provenance: Provenance


def parse_cli(script_name: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog=script_name)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def read_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def build_envelope(
    *,
    script_name: str,
    source_payload: dict[str, Any],
    data: dict[str, Any] | None = None,
    errors: list[str] | None = None,
) -> dict[str, Any]:
    envelope = Envelope(
        ok=not errors,
        data=data or {},
        errors=errors or [],
        provenance=Provenance(
            source_ids=list(source_payload.get("source_ids", [])),
            retrieved=source_payload.get("retrieved"),
            script=script_name,
        ),
    )
    return envelope.model_dump(mode="json")


def canonical_concept(source_concept: str) -> str:
    return CONCEPT_ALIASES.get(source_concept, source_concept)


def extract_facts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    facts = []
    for fact in payload.get("facts", []):
        facts.append(
            {
                "canonical_concept": canonical_concept(fact["concept"]),
                "source_concept": fact["concept"],
                "label": fact.get("label") or ROW_LABELS.get(canonical_concept(fact["concept"]), fact["concept"]),
                "value": fact["value"],
                "unit": fact["unit"],
                "period": fact["period"],
                "context": fact.get("context"),
                "statement": fact.get("statement") or STATEMENT_MAP.get(canonical_concept(fact["concept"]), "other"),
            }
        )
    return facts


def parse_unit_token(unit: str) -> dict[str, Any]:
    token = unit.strip()

    if token.endswith("_per_share"):
        currency = token.replace("_per_share", "")
        return {
            "measurement": "per_share",
            "base_unit": f"{currency}_per_share",
            "currency": currency,
            "scale": "unit",
            "multiplier": 1.0,
        }

    parts = token.split("_")
    head = parts[0]
    scale_token = parts[1] if len(parts) > 1 else "unit"
    if scale_token.endswith("s"):
        scale_token = scale_token[:-1]

    if head in {"USD", "EUR", "JPY", "GBP"}:
        return {
            "measurement": "currency",
            "base_unit": head,
            "currency": head,
            "scale": scale_token,
            "multiplier": SCALE_FACTORS.get(scale_token, 1.0),
        }

    if head == "shares":
        return {
            "measurement": "shares",
            "base_unit": "shares",
            "currency": None,
            "scale": scale_token,
            "multiplier": SCALE_FACTORS.get(scale_token, 1.0),
        }

    return {
        "measurement": "other",
        "base_unit": token,
        "currency": None,
        "scale": "unit",
        "multiplier": 1.0,
    }


def find_fx_rate(payload: dict[str, Any], from_currency: str, to_currency: str) -> tuple[float | None, str | None]:
    for rate in payload.get("fx_rates", []):
        if rate.get("from") == from_currency and rate.get("to") == to_currency:
            return float(rate["rate"]), rate.get("timestamp")
    return None, None


def round6(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 6)


def safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def average_of_present(*values: float | int | None) -> float:
    present = [float(value) for value in values if value is not None]
    if not present:
        return 0.0
    return sum(present) / len(present)


def percentile_rank(values: list[float], subject: float) -> float | None:
    if not values:
        return None
    count = sum(1 for value in values if value <= subject)
    return (count / len(values)) * 100.0


def _quartile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] + ((ordered[upper] - ordered[lower]) * weight)


def iqr_bounds(values: list[float]) -> tuple[float, float]:
    q1 = _quartile(values, 0.25)
    q3 = _quartile(values, 0.75)
    spread = q3 - q1
    return q1 - (1.5 * spread), q3 + (1.5 * spread)


def trailing_window(values: list[float], window: int) -> list[float]:
    if window <= 0:
        return []
    return values[-window:]


def parse_iso_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    token = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(token)
    except ValueError:
        return None


def age_in_days(now_raw: str, timestamp_raw: str) -> float | None:
    now = parse_iso_datetime(now_raw)
    timestamp = parse_iso_datetime(timestamp_raw)
    if now is None or timestamp is None:
        return None
    return (now - timestamp).total_seconds() / 86_400.0


def relative_difference(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    high = max(values)
    low = min(values)
    scale = max(abs(high), abs(low), 1.0)
    return abs(high - low) / scale


def population_std(values: list[float]) -> float:
    if len(values) <= 1:
        return 0.0
    return statistics.pstdev(values)
