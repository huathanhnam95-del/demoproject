from __future__ import annotations

from collections import Counter
from typing import Any


MODEL_KEYS = ("dr", "qw", "gm")


def apply_component_decision(votes: dict[str, str], *, revised: bool) -> dict[str, Any]:
    normalized = {key: str(votes.get(key) or "").upper() for key in MODEL_KEYS}
    passes = sum(value == "PASS" for value in normalized.values())
    if revised:
        status = "REVISED_WITH_UNANIMOUS_CONSENSUS" if passes == 3 else "QUARANTINED"
    elif passes == 3:
        status = "PASSED_UNCONTESTED"
    elif passes >= 2:
        status = "PASSED_MAJORITY"
    else:
        status = "DEBATE_REQUIRED"
    return {"status": status, "votes": normalized, "passCount": passes}


def component_dependencies(component: str) -> set[str]:
    return {
        "promptBreakdown": {"angles", "languageKit", "plans", "scaffolds", "faq"},
        "angles": {"languageKit", "plans", "scaffolds", "faq"},
        "languageKit": {"plans", "scaffolds", "faq"},
        "plans": {"scaffolds", "faq"},
        "scaffolds": set(),
        "faq": set(),
        "eltAudit": {"languageKit", "plans", "scaffolds", "faq"},
    }.get(component, set())


def aggregate_audit_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts: Counter[str] = Counter()
    component_counts: Counter[str] = Counter()
    questions_with_quarantine = set()
    for record in records:
        question_id = str(record.get("questionId") or "")
        for component, detail in (record.get("components") or {}).items():
            status = str((detail or {}).get("status") or "UNKNOWN")
            status_counts[status] += 1
            component_counts[component] += 1
            if status == "QUARANTINED":
                questions_with_quarantine.add(question_id)
    return {
        "questionsProcessed": len(records),
        "componentsProcessed": sum(component_counts.values()),
        "componentStatusCounts": dict(sorted(status_counts.items())),
        "questionsQuarantined": sorted(questions_with_quarantine, key=lambda value: int(value or 0)),
    }

