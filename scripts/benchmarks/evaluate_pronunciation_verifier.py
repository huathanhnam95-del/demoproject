#!/usr/bin/env python3
"""Evaluate a frozen verifier once on an untouched dataset split."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_verifier import _evaluate_head, evaluate_model, evaluate_stress_ranker, load_artifact
from scripts.benchmarks.train_pronunciation_verifier import COUNT_FEATURES, STRESS_FEATURES


def precision(decisions: list[dict[str, Any]], status: str) -> tuple[float | None, int]:
    selected = [row for row in decisions if row["status"] == status]
    if not selected:
        return None, 0
    expected_truth = 1 if status == "verified" else 0
    return sum(int(row["truth_matches"]) == expected_truth for row in selected) / len(selected), len(selected)


def bootstrap_precision_lower(
    decisions: list[dict[str, Any]],
    status: str,
    *,
    seed: int = 20260730,
    iterations: int = 2000,
) -> float | None:
    selected = [row for row in decisions if row["status"] == status]
    if not selected:
        return None
    correctness = np.asarray([
        int(bool(row["truth_matches"])) if status == "verified" else int(not bool(row["truth_matches"]))
        for row in selected
    ], dtype=float)
    rng = np.random.default_rng(seed)
    estimates = [
        float(rng.choice(correctness, size=len(correctness), replace=True).mean())
        for _ in range(iterations)
    ]
    return float(np.quantile(estimates, 0.025))


def expected_calibration_error(probabilities: list[float], labels: list[int], bins: int = 10) -> float | None:
    if not probabilities:
        return None
    probabilities_array = np.asarray(probabilities, dtype=float)
    labels_array = np.asarray(labels, dtype=float)
    total = len(probabilities_array)
    error = 0.0
    for lower in np.linspace(0.0, 1.0, bins + 1)[:-1]:
        upper = lower + (1.0 / bins)
        mask = (probabilities_array >= lower) & (
            probabilities_array <= upper if upper >= 1.0 else probabilities_array < upper
        )
        if mask.any():
            error += float(mask.mean()) * abs(float(probabilities_array[mask].mean()) - float(labels_array[mask].mean()))
    return error


def evaluate(
    dataset: dict[str, Any],
    features: dict[str, Any],
    artifact: dict[str, Any],
    *,
    split: str = "test",
) -> dict[str, Any]:
    feature_by_id = {str(row["id"]): row for row in features.get("records") or []}
    split_rows = [row for row in dataset.get("records") or [] if row.get("split") == split]
    source_by_id = {str(row["id"]): row for row in split_rows}
    eligible = [
        row
        for row in split_rows
        if row.get("label_count") is not None
        and (int(row.get("syllable_count") or 0) <= 1 or row.get("label_stress") is not None)
    ]
    eligible_ids = {str(row["id"]) for row in eligible}
    decisions: list[dict[str, Any]] = []
    count_mismatches = 0
    count_mismatch_detected = 0
    stress_mismatches = 0
    stress_mismatch_detected = 0
    probabilities: list[float] = []
    probability_labels: list[int] = []
    stress_full_probabilities: list[float] = []
    stress_alignment_probabilities: list[float] = []
    stress_prior_probabilities: list[float] = []
    stress_ablation_labels: list[int] = []

    component_decisions: list[dict[str, Any]] = []
    for row in split_rows:
        feature_row = feature_by_id.get(str(row["id"]))
        stress_expected = int(row.get("syllable_count") or 0) > 1
        stress_labelled = row.get("label_stress") is not None
        overall_evaluable = str(row["id"]) in eligible_ids
        truth_matches = (
            bool(row.get("label_count"))
            and (not stress_expected or bool(row.get("label_stress")))
            if overall_evaluable
            else None
        )
        status = "unrateable"
        count_status = "unrateable"
        stress_status = "unrateable"
        overall_probability = None
        if feature_row:
            diagnostics = feature_row.get("diagnostics") or {}
            values = feature_row.get("features") or {}
            if diagnostics.get("decoded_is_rateable") is True:
                scored = evaluate_model(artifact, {
                    "count": [float(values[name]) for name in COUNT_FEATURES],
                    "stress": [float(values[name]) for name in STRESS_FEATURES],
                })
                if (artifact.get("stress") or {}).get("mode") == "ranker":
                    ranker = evaluate_stress_ranker(
                        artifact["stress"],
                        feature_row.get("stress_nuclei") or [],
                        expected_index=int(diagnostics.get("expected_stress") or 0),
                    )
                    scored["stress"] = {
                        "status": ranker["status"],
                        "confidence": ranker["confidence"],
                        "match_probability": ranker["confidence"] if ranker["status"] == "verified" else 0.0,
                    }
                if stress_labelled and diagnostics.get("all_nuclei_voiced") is True:
                    ablations = artifact.get("ablations") or {}
                    alignment = ablations.get("alignment_only") or {}
                    prior = ablations.get("prior_only") or {}
                    alignment_model = alignment.get("model")
                    alignment_indices = alignment.get("feature_indices") or []
                    if alignment_model and alignment_indices and isinstance(prior.get("probability"), (int, float)):
                        stress_vector = [float(values[name]) for name in STRESS_FEATURES]
                        alignment_values = [stress_vector[int(index)] for index in alignment_indices]
                        alignment_score = _evaluate_head(
                            alignment_model,
                            alignment_values,
                            alignment.get("isotonic"),
                        )
                        stress_full_probabilities.append(float(scored["stress"]["match_probability"]))
                        stress_alignment_probabilities.append(float(alignment_score["match_probability"]))
                        stress_prior_probabilities.append(float(prior["probability"]))
                        stress_ablation_labels.append(int(row["label_stress"]))
                count_status = scored["count"]["status"]
                stress_status = (
                    scored["stress"]["status"]
                    if stress_expected and diagnostics.get("all_nuclei_voiced")
                    else ("not_applicable" if not stress_expected else "unrateable")
                )
                applicable = [count_status] + ([stress_status] if stress_expected else [])
                if "incorrect" in applicable:
                    status = "incorrect"
                elif all(value == "verified" for value in applicable):
                    status = "verified"
                overall_probability = min(
                    [scored["count"]["match_probability"]]
                    + ([scored["stress"]["match_probability"]] if stress_expected and stress_status != "unrateable" else [])
                )
                if overall_evaluable:
                    probabilities.append(float(overall_probability))
                    probability_labels.append(int(bool(truth_matches)))
        decision = {
            "id": row["id"],
            "gender": row.get("gender"),
            "status": status,
            "count_status": count_status,
            "stress_status": stress_status,
            "truth_matches": truth_matches,
            "match_probability": float(overall_probability) if overall_probability is not None else None,
            "overall_evaluable": overall_evaluable,
        }
        component_decisions.append(decision)
        if overall_evaluable:
            decisions.append(decision)
        if row.get("label_count") == 0:
            count_mismatches += 1
            count_mismatch_detected += int(count_status == "incorrect")
        if row.get("label_stress") == 0:
            stress_mismatches += 1
            stress_mismatch_detected += int(stress_status == "incorrect")

    verified_precision, verified_count = precision(decisions, "verified")
    incorrect_precision, incorrect_count = precision(decisions, "incorrect")
    accepted = verified_count + incorrect_count
    subgroup = {}
    for gender in sorted({str(row.get("gender") or "unknown") for row in decisions}):
        group = [row for row in decisions if str(row.get("gender") or "unknown") == gender]
        group_verified, group_verified_count = precision(group, "verified")
        group_incorrect, group_incorrect_count = precision(group, "incorrect")
        accepted_group = [row for row in group if row["status"] in {"verified", "incorrect"}]
        accepted_correct = [
            row
            for row in accepted_group
            if (row["status"] == "verified") == bool(row["truth_matches"])
        ]
        group_probabilities = [
            float(row["match_probability"])
            for row in group
            if row["match_probability"] is not None
        ]
        group_labels = [
            int(bool(row["truth_matches"]))
            for row in group
            if row["match_probability"] is not None
        ]
        subgroup[gender] = {
            "eligible": len(group),
            "coverage": (group_verified_count + group_incorrect_count) / len(group) if group else 0.0,
            "accepted_precision": len(accepted_correct) / len(accepted_group) if accepted_group else None,
            "verified_precision": group_verified,
            "incorrect_precision": group_incorrect,
            "expected_calibration_error": expected_calibration_error(group_probabilities, group_labels),
        }

    count_labelled = [
        row
        for row in component_decisions
        if source_by_id[str(row["id"])].get("label_count") is not None
    ]
    stress_labelled = [
        row
        for row in component_decisions
        if source_by_id[str(row["id"])].get("label_stress") is not None
    ]
    metrics = {
        "eligible": len(eligible),
        "unknown_ground_truth": len(split_rows) - len(eligible),
        "verified_precision": verified_precision,
        "verified_decisions": verified_count,
        "verified_precision_bootstrap_lower_95": bootstrap_precision_lower(decisions, "verified"),
        "incorrect_precision": incorrect_precision,
        "incorrect_decisions": incorrect_count,
        "incorrect_precision_bootstrap_lower_95": bootstrap_precision_lower(decisions, "incorrect"),
        "coverage": accepted / len(eligible) if eligible else 0.0,
        "count_mismatch_recall": count_mismatch_detected / count_mismatches if count_mismatches else None,
        "count_mismatch_support": count_mismatches,
        "stress_mismatch_recall": stress_mismatch_detected / stress_mismatches if stress_mismatches else None,
        "stress_mismatch_support": stress_mismatches,
        "expected_calibration_error": expected_calibration_error(probabilities, probability_labels),
        "count_component_coverage": (
            sum(row["count_status"] in {"verified", "incorrect"} for row in count_labelled) / len(count_labelled)
            if count_labelled
            else 0.0
        ),
        "stress_component_coverage": (
            sum(row["stress_status"] in {"verified", "incorrect"} for row in stress_labelled) / len(stress_labelled)
            if stress_labelled
            else 0.0
        ),
        "subgroups": subgroup,
    }
    if stress_ablation_labels:
        labels_array = np.asarray(stress_ablation_labels, dtype=float)
        stress_ablation = {
            "support": len(stress_ablation_labels),
            "full_acoustic_brier": float(np.mean((np.asarray(stress_full_probabilities) - labels_array) ** 2)),
            "alignment_only_brier": float(np.mean((np.asarray(stress_alignment_probabilities) - labels_array) ** 2)),
            "prior_only_brier": float(np.mean((np.asarray(stress_prior_probabilities) - labels_array) ** 2)),
            "required_margin": 0.01,
        }
        stress_ablation["full_beats_both"] = (
            stress_ablation["full_acoustic_brier"] + stress_ablation["required_margin"]
            < min(stress_ablation["alignment_only_brier"], stress_ablation["prior_only_brier"])
        )
    else:
        stress_ablation = {
            "support": 0,
            "full_acoustic_brier": None,
            "alignment_only_brier": None,
            "prior_only_brier": None,
            "required_margin": 0.01,
            "full_beats_both": False,
        }
    metrics["stress_ablation"] = stress_ablation
    female = subgroup.get("f") or subgroup.get("female") or {}
    male = subgroup.get("m") or subgroup.get("male") or {}
    gates = {
        "verified_precision": verified_precision is not None and verified_precision >= 0.95,
        "incorrect_precision": incorrect_precision is not None and incorrect_precision >= 0.95,
        "verified_decisions": verified_count >= 50,
        "incorrect_decisions": incorrect_count >= 50,
        "coverage": metrics["coverage"] >= 0.80,
        "count_mismatch_recall": metrics["count_mismatch_recall"] is not None and metrics["count_mismatch_recall"] >= 0.60,
        "stress_mismatch_recall": metrics["stress_mismatch_recall"] is not None and metrics["stress_mismatch_recall"] >= 0.50,
        "expected_calibration_error": metrics["expected_calibration_error"] is not None and metrics["expected_calibration_error"] <= 0.05,
        "verified_bootstrap_lower": metrics["verified_precision_bootstrap_lower_95"] is not None and metrics["verified_precision_bootstrap_lower_95"] >= 0.90,
        "incorrect_bootstrap_lower": metrics["incorrect_precision_bootstrap_lower_95"] is not None and metrics["incorrect_precision_bootstrap_lower_95"] >= 0.90,
        "female_subgroup_precision": female.get("accepted_precision") is not None and female["accepted_precision"] >= 0.90,
        "male_subgroup_precision": male.get("accepted_precision") is not None and male["accepted_precision"] >= 0.90,
        "acoustic_ablation": stress_ablation["full_beats_both"] is True,
    }
    return {
        "schema_version": "pronunciation-verifier-evaluation-v1",
        "split": split,
        "artifact_sha256": artifact["artifact_sha256"],
        "metrics": metrics,
        "gates": gates,
        "passed": all(gates.values()),
        "decisions": decisions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", default="test")
    args = parser.parse_args()
    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    features = json.loads(args.features.read_text(encoding="utf-8"))
    artifact = load_artifact(args.artifact)
    result = evaluate(dataset, features, artifact, split=args.split)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "passed": result["passed"], "metrics": result["metrics"], "gates": result["gates"]}, indent=2))
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
