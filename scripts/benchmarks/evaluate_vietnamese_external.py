#!/usr/bin/env python3
"""Evaluate the frozen verifier on existing Vietnamese-L1 recordings."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_verifier import evaluate_model, load_artifact
from scripts.benchmarks.train_pronunciation_verifier import COUNT_FEATURES, STRESS_FEATURES


def evaluate(
    dataset: dict[str, Any],
    features: dict[str, Any],
    artifact: dict[str, Any],
) -> dict[str, Any]:
    feature_by_id = {str(row["id"]): row for row in features.get("records") or []}
    decisions: list[dict[str, Any]] = []
    for row in dataset.get("records") or []:
        count_status = "unrateable"
        stress_status = "not_applicable" if int(row.get("syllable_count") or 0) <= 1 else "unrateable"
        count_confidence = 0.0
        stress_confidence = 0.0
        feature_row = feature_by_id.get(str(row["id"]))
        if feature_row and (feature_row.get("diagnostics") or {}).get("decoded_is_rateable") is True:
            values = feature_row.get("features") or {}
            scored = evaluate_model(
                artifact,
                {
                    "count": [float(values[name]) for name in COUNT_FEATURES],
                    "stress": [float(values[name]) for name in STRESS_FEATURES],
                },
            )
            count_status = scored["count"]["status"]
            count_confidence = float(scored["count"]["confidence"])
            if int(row.get("syllable_count") or 0) > 1:
                if (feature_row.get("diagnostics") or {}).get("all_nuclei_voiced") is True:
                    stress_status = scored["stress"]["status"]
                    stress_confidence = float(scored["stress"]["confidence"])
        statuses = [count_status] + ([stress_status] if stress_status != "not_applicable" else [])
        overall = (
            "incorrect"
            if "incorrect" in statuses
            else "verified"
            if statuses and all(status == "verified" for status in statuses)
            else "unrateable"
        )
        decisions.append(
            {
                "id": row["id"],
                "word": row.get("word"),
                "category": row.get("category"),
                "count_status": count_status,
                "count_confidence": count_confidence,
                "stress_status": stress_status,
                "stress_confidence": stress_confidence,
                "overall_status": overall,
                "label_count": row.get("label_count"),
                "label_stress": row.get("label_stress"),
            }
        )

    clean = [row for row in decisions if row["category"] == "clean"]
    clean_count_accepted = [
        row for row in clean if row["count_status"] in {"verified", "incorrect"}
    ]
    clean_count_correct = [
        row
        for row in clean_count_accepted
        if (row["count_status"] == "verified") == bool(row["label_count"])
    ]
    clean_poly = [
        row
        for row in clean
        if row["label_stress"] is not None
    ]
    clean_metrics = {
        "eligible": len(clean),
        "count_accepted_precision": (
            len(clean_count_correct) / len(clean_count_accepted)
            if clean_count_accepted
            else None
        ),
        "count_coverage": len(clean_count_accepted) / len(clean) if clean else 0.0,
        "polysyllabic_stress_eligible": len(clean_poly),
        "polysyllabic_stress_verified_rate": (
            sum(row["stress_status"] == "verified" for row in clean_poly) / len(clean_poly)
            if clean_poly
            else None
        ),
    }
    gates = {
        "clean_count_precision": (
            clean_metrics["count_accepted_precision"] is not None
            and clean_metrics["count_accepted_precision"] >= 0.95
        ),
        "clean_count_coverage": clean_metrics["count_coverage"] >= 0.80,
        "clean_stress_verified_rate": (
            clean_metrics["polysyllabic_stress_verified_rate"] is not None
            and clean_metrics["polysyllabic_stress_verified_rate"] >= 0.80
        ),
    }
    return {
        "schema_version": "vietnamese-external-evaluation-v1",
        "artifact_sha256": artifact["artifact_sha256"],
        "clean": clean_metrics,
        "non_clean_individual": [
            row for row in decisions if row["category"] != "clean"
        ],
        "gates": gates,
        "passed": all(gates.values()),
    }


def evaluate_transformed(
    dataset: dict[str, Any],
    features: dict[str, Any],
    artifact: dict[str, Any],
) -> dict[str, Any]:
    feature_by_id = {str(row["id"]): row for row in features.get("records") or []}
    decisions: list[dict[str, Any]] = []
    for row in dataset.get("records") or []:
        operator = str(row.get("transformation_operator") or row.get("category") or "")
        relevant_component = "stress" if operator == "wrong_stress" else "count"
        status = "unrateable"
        confidence = 0.0
        feature_row = feature_by_id.get(str(row["id"]))
        diagnostics = (feature_row or {}).get("diagnostics") or {}
        component_rateable = (
            diagnostics.get("decoded_is_rateable") is True
            and (
                relevant_component == "count"
                or diagnostics.get("all_nuclei_voiced") is True
            )
        )
        if feature_row and component_rateable:
            values = feature_row.get("features") or {}
            scored = evaluate_model(
                artifact,
                {
                    "count": [float(values[name]) for name in COUNT_FEATURES],
                    "stress": [float(values[name]) for name in STRESS_FEATURES],
                },
            )
            status = scored[relevant_component]["status"]
            confidence = float(scored[relevant_component]["confidence"])
        decisions.append(
            {
                "id": row["id"],
                "parent_id": row.get("parent_id"),
                "operator": operator,
                "relevant_component": relevant_component,
                "status": status,
                "confidence": confidence,
            }
        )
    total = len(decisions)
    incorrect = sum(row["status"] == "incorrect" for row in decisions)
    incorrectly_verified = sum(row["status"] == "verified" for row in decisions)
    unrateable = sum(row["status"] == "unrateable" for row in decisions)
    incorrect_rate = incorrect / total if total else 0.0
    gates = {
        "zero_incorrectly_verified": incorrectly_verified == 0,
        "incorrect_rate": incorrect_rate >= 0.60,
    }
    return {
        "schema_version": "vietnamese-transformed-evaluation-v1",
        "artifact_sha256": artifact["artifact_sha256"],
        "eligible": total,
        "incorrect": incorrect,
        "incorrectly_verified": incorrectly_verified,
        "unrateable": unrateable,
        "incorrect_rate": incorrect_rate,
        "gates": gates,
        "passed": total > 0 and all(gates.values()),
        "decisions": decisions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--transformed-dataset", type=Path)
    parser.add_argument("--transformed-features", type=Path)
    parser.add_argument("--transformed-output", type=Path)
    args = parser.parse_args()
    result = evaluate(
        json.loads(args.dataset.read_text(encoding="utf-8")),
        json.loads(args.features.read_text(encoding="utf-8")),
        load_artifact(args.artifact),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    transformed_result = None
    if args.transformed_dataset or args.transformed_features or args.transformed_output:
        if not (args.transformed_dataset and args.transformed_features and args.transformed_output):
            raise SystemExit("all transformed evaluation arguments are required together")
        transformed_result = evaluate_transformed(
            json.loads(args.transformed_dataset.read_text(encoding="utf-8")),
            json.loads(args.transformed_features.read_text(encoding="utf-8")),
            load_artifact(args.artifact),
        )
        args.transformed_output.parent.mkdir(parents=True, exist_ok=True)
        args.transformed_output.write_text(
            json.dumps(transformed_result, indent=2),
            encoding="utf-8",
        )
    print(json.dumps({"external": result, "transformed": transformed_result}, indent=2))
    passed = result["passed"] and (
        transformed_result is None or transformed_result["passed"]
    )
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
