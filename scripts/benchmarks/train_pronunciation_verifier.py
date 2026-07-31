#!/usr/bin/env python3
"""Train/export the lightweight JSON pronunciation verifier."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.local_server.pronunciation_verifier import FEATURE_SCHEMA_VERSION, SCHEMA_VERSION, artifact_sha256

COUNT_FEATURES = ["count_delta", "mean_nucleus_confidence", "min_nucleus_confidence", "canonical_log_likelihood", "canonical_minus_omission", "canonical_minus_insertion", "alignment_confidence", "observed_duration_per_expected_syllable"]
STRESS_FEATURES = [
    "expected_duration_margin",
    "expected_intensity_margin",
    "expected_f0_median_margin",
    "expected_f0_range_margin",
    "expected_f0_slope_margin",
    "expected_spectral_tilt_margin",
    "mean_nucleus_confidence",
    "min_nucleus_confidence",
    "mean_voiced_confidence",
    "min_voiced_confidence",
]
STRESS_RANKER_FEATURES = [
    "duration_sec", "intensity_db", "f0_median", "f0_range",
    "f0_slope", "spectral_tilt", "nucleus_confidence", "voiced_confidence",
]


def _vectors(rows: list[dict[str, Any]], names: list[str], label_name: str) -> tuple[np.ndarray, np.ndarray]:
    def is_rateable(row: dict[str, Any]) -> bool:
        diagnostics = row.get("diagnostics") or {}
        if diagnostics.get("decoded_is_rateable") is not True:
            return False
        if label_name == "label_stress" and diagnostics.get("all_nuclei_voiced") is not True:
            return False
        return True

    labelled = [
        row
        for row in rows
        if row.get(label_name) is not None and is_rateable(row)
    ]
    vectors: list[list[float]] = []
    for row in labelled:
        values = row.get("features") or {}
        vector: list[float] = []
        for name in names:
            if name not in values:
                raise ValueError(f"missing feature {name} in row {row.get('id', '<unknown>')}")
            value = float(values[name])
            if not math.isfinite(value):
                raise ValueError(f"non-finite feature {name} in row {row.get('id', '<unknown>')}")
            vector.append(value)
        vectors.append(vector)
    x = np.asarray(vectors, dtype=float)
    y = np.asarray([int(row[label_name]) for row in labelled], dtype=int)
    return x, y


def _fit_head(x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    if len(y) == 0:
        raise ValueError("training split has no labelled rows")
    if len(set(y.tolist())) < 2:
        # A deterministic prior-only artifact is still valid for a dry run.
        probability = float(y.mean()) if len(y) else 0.5
        return {"mean": [0.0] * x.shape[1], "scale": [1.0] * x.shape[1], "coefficients": [0.0] * x.shape[1], "intercept": float(np.log((probability + 1e-4) / (1 - probability + 1e-4))), "thresholds": {"verified": 1.000001, "incorrect": -0.000001}}
    scaler = StandardScaler().fit(x)
    model = LogisticRegression(class_weight="balanced", random_state=20260730, max_iter=1000).fit(scaler.transform(x), y)
    return {"mean": scaler.mean_.round(8).tolist(), "scale": scaler.scale_.round(8).tolist(), "coefficients": model.coef_[0].round(8).tolist(), "intercept": round(float(model.intercept_[0]), 8), "thresholds": {"verified": 0.8, "incorrect": 0.2}}


def _raw_probabilities(head: dict[str, Any], x: np.ndarray) -> np.ndarray:
    mean = np.asarray(head["mean"])
    scale = np.asarray(head["scale"])
    z = head["intercept"] + ((x - mean) / np.where(scale == 0, 1, scale)) @ np.asarray(head["coefficients"])
    return 1 / (1 + np.exp(-np.clip(z, -60, 60)))


def _calibrate(head: dict[str, Any], x: np.ndarray, y: np.ndarray) -> tuple[list[list[float]], np.ndarray]:
    if len(y) == 0:
        raise ValueError("calibration split has no labelled rows")
    raw = _raw_probabilities(head, x)
    if len(set(y.tolist())) < 2:
        value = float(y.mean())
        return [[0.0, value], [1.0, value]], np.full_like(raw, value)
    iso = IsotonicRegression(out_of_bounds="clip").fit(raw, y)
    order = np.argsort(iso.X_thresholds_)
    points = [[round(float(iso.X_thresholds_[i]), 8), round(float(iso.y_thresholds_[i]), 8)] for i in order]
    return points, iso.predict(raw)


def select_thresholds(probabilities: list[float] | np.ndarray, labels: list[int] | np.ndarray, *, min_precision: float = 0.95) -> dict[str, Any]:
    probabilities = np.asarray(probabilities, dtype=float)
    labels = np.asarray(labels, dtype=int)
    if len(probabilities) != len(labels) or len(labels) == 0:
        raise ValueError("threshold selection requires equally sized non-empty probabilities and labels")

    verified_options: list[tuple[int, float, float]] = []
    incorrect_options: list[tuple[int, float, float]] = []
    for threshold in sorted(set(probabilities.tolist())):
        verified_mask = probabilities >= threshold
        if verified_mask.any():
            precision = float(labels[verified_mask].mean())
            if precision >= min_precision:
                verified_options.append((int(verified_mask.sum()), float(threshold), precision))
        incorrect_mask = probabilities <= threshold
        if incorrect_mask.any():
            precision = float((labels[incorrect_mask] == 0).mean())
            if precision >= min_precision:
                incorrect_options.append((int(incorrect_mask.sum()), float(threshold), precision))

    verified = max(verified_options, key=lambda item: (item[0], -item[1])) if verified_options else (0, 1.000001, 1.0)
    incorrect = max(incorrect_options, key=lambda item: (item[0], item[1])) if incorrect_options else (0, -0.000001, 1.0)
    if incorrect[1] >= verified[1]:
        # Keep the abstention interval explicit if calibration probabilities
        # collapse to the same isotonic value.
        incorrect = (0, min(-0.000001, verified[1] - 0.000001), 1.0)
    return {
        "verified": round(verified[1], 8),
        "incorrect": round(incorrect[1], 8),
        "verified_precision": round(verified[2], 8),
        "incorrect_precision": round(incorrect[2], 8),
        "verified_decisions": verified[0],
        "incorrect_decisions": incorrect[0],
        "selection_min_precision": min_precision,
    }


def _ranker_rows(rows: list[dict[str, Any]]) -> list[tuple[list[dict[str, float]], int]]:
    selected = []
    for row in rows:
        if row.get("label_stress") != 1:
            continue
        if (row.get("diagnostics") or {}).get("all_nuclei_voiced") is not True:
            continue
        expected = (row.get("diagnostics") or {}).get("expected_stress")
        nuclei = row.get("stress_nuclei")
        if not isinstance(expected, int) or not isinstance(nuclei, list) or len(nuclei) < 2 or expected >= len(nuclei):
            continue
        if any(not all(isinstance(item.get(name), (int, float)) and math.isfinite(float(item.get(name))) for name in STRESS_RANKER_FEATURES) for item in nuclei):
            continue
        selected.append((nuclei, expected))
    return selected


def _fit_stress_ranker(rows: list[dict[str, Any]], calibration_rows: list[dict[str, Any]]) -> dict[str, Any]:
    training = _ranker_rows(rows)
    calibration = _ranker_rows(calibration_rows)
    # Without per-nucleus rows the ranker would silently fall back to
    # hand-written weights and export an artifact that looks trained. Fail
    # instead, so feature shards missing `stress_nuclei` cannot be promoted.
    if not training:
        raise ValueError(
            "stress ranker has no eligible training rows; "
            "re-extract features so rows carry stress_nuclei"
        )
    if not calibration:
        raise ValueError(
            "stress ranker has no eligible calibration rows; "
            "re-extract features so rows carry stress_nuclei"
        )
    margins: list[list[float]] = []
    for nuclei, expected in training:
        normalized = {}
        for name in STRESS_RANKER_FEATURES:
            values = np.asarray([float(item[name]) for item in nuclei], dtype=float)
            normalized[name] = (values - values.mean()) / (values.std() or 1.0)
        row_margins = []
        for name in STRESS_RANKER_FEATURES:
            expected_value = normalized[name][expected]
            alternative = max(value for index, value in enumerate(normalized[name]) if index != expected)
            row_margins.append(float(expected_value - alternative))
        margins.append(row_margins)

    weights = np.asarray(margins, dtype=float).mean(axis=0)
    weights = np.where(np.isfinite(weights) & (weights > 0), weights, 0.05)
    weights = (weights / max(float(weights.mean()), 1e-6)).round(8)

    calibration_margins = []
    for nuclei, expected in calibration:
        normalized = {}
        for name in STRESS_RANKER_FEATURES:
            values = np.asarray([float(item[name]) for item in nuclei], dtype=float)
            normalized[name] = (values - values.mean()) / (values.std() or 1.0)
        scores = np.zeros(len(nuclei), dtype=float)
        for weight, name in zip(weights, STRESS_RANKER_FEATURES):
            scores += float(weight) * normalized[name]
        alternatives = [score for index, score in enumerate(scores) if index != expected]
        calibration_margins.append(float(scores[expected] - max(alternatives)))
    positive_margin = float(np.quantile(calibration_margins, 0.2))
    return {
        "mode": "ranker",
        "features": STRESS_RANKER_FEATURES,
        "weights": weights.tolist(),
        "means": [0.0] * len(STRESS_RANKER_FEATURES),
        "scales": [1.0] * len(STRESS_RANKER_FEATURES),
        "margin_threshold": round(max(0.15, positive_margin), 8),
        "min_confidence": 0.7,
        "training_positive_rows": len(training),
        "calibration_positive_rows": len(calibration),
    }


#: Sentinel that keeps a decision class permanently abstaining. Model
#: probabilities live in [0, 1], so nothing can ever reach it.
DISABLED_INCORRECT_THRESHOLD = -0.000001


def _disabled_stress_head(reason: str) -> dict[str, Any]:
    return {
        "mode": "disabled",
        "reason": reason,
        "features": STRESS_RANKER_FEATURES,
    }


def train(rows: list[dict[str, Any]], *, count_only: bool = False) -> dict[str, Any]:
    train_rows = [row for row in rows if row.get("split") in {"train", "train_augmentation"}]
    calibration_rows = [row for row in rows if row.get("split") == "calibration"]
    train_speakers = {str(row.get("speaker_id")) for row in train_rows}
    calibration_speakers = {str(row.get("speaker_id")) for row in calibration_rows}
    if train_speakers & calibration_speakers:
        raise ValueError("speaker leakage between train and calibration splits")
    if not train_rows or not calibration_rows:
        raise ValueError("both train and calibration splits are required")

    count_train_x, count_train_y = _vectors(train_rows, COUNT_FEATURES, "label_count")
    count_calibration_x, count_calibration_y = _vectors(calibration_rows, COUNT_FEATURES, "label_count")
    count = _fit_head(count_train_x, count_train_y)
    count_points, count_probabilities = _calibrate(count, count_calibration_x, count_calibration_y)
    count["thresholds"] = select_thresholds(count_probabilities, count_calibration_y)

    if count_only:
        # Count-only release: the stress head is not fitted, not exported, and
        # cannot be scored. The count head keeps its calibrated `verified`
        # threshold but can never return `incorrect`, because the corpus does
        # not carry enough mismatch labels to support that claim.
        count["thresholds"]["incorrect"] = DISABLED_INCORRECT_THRESHOLD
        count["thresholds"]["incorrect_decisions"] = 0
        count["thresholds"]["incorrect_disabled_reason"] = "INSUFFICIENT_MISMATCH_LABELS"
        dataset_hash = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        artifact = {
            "schema_version": SCHEMA_VERSION,
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "seed": 20260730,
            "release_profile": "count-only",
            "features": {"count": COUNT_FEATURES},
            "count": count,
            "stress": _disabled_stress_head("INSUFFICIENT_MISMATCH_LABELS"),
            "isotonic": {"count": count_points},
            "threshold_policy": "count_only_verified_precision_first",
            "training_support": {
                "train": len(train_rows),
                "calibration": len(calibration_rows),
                "train_count_labels": len(count_train_y),
                "calibration_count_labels": len(count_calibration_y),
            },
            "dataset_hash": dataset_hash,
        }
        artifact["artifact_sha256"] = artifact_sha256(artifact)
        return artifact

    stress_train_x, stress_train_y = _vectors(train_rows, STRESS_FEATURES, "label_stress")
    stress_calibration_x, stress_calibration_y = _vectors(calibration_rows, STRESS_FEATURES, "label_stress")
    stress_binary = _fit_head(stress_train_x, stress_train_y)
    stress_points, stress_probabilities = _calibrate(stress_binary, stress_calibration_x, stress_calibration_y)
    stress_binary["thresholds"] = select_thresholds(stress_probabilities, stress_calibration_y)
    stress = _fit_stress_ranker(train_rows, calibration_rows)
    prior_probability = float(stress_train_y.mean())
    prior_brier = float(np.mean((np.full_like(stress_calibration_y, prior_probability, dtype=float) - stress_calibration_y) ** 2))
    alignment_indices = [6, 7, 8, 9]
    alignment_head = _fit_head(stress_train_x[:, alignment_indices], stress_train_y)
    alignment_points, alignment_probabilities = _calibrate(
        alignment_head,
        stress_calibration_x[:, alignment_indices],
        stress_calibration_y,
    )
    alignment_brier = float(np.mean((alignment_probabilities - stress_calibration_y) ** 2))
    full_brier = float(np.mean((stress_probabilities - stress_calibration_y) ** 2))
    dataset_hash = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    artifact = {
        "schema_version": SCHEMA_VERSION,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "seed": 20260730,
        "features": {"count": COUNT_FEATURES, "stress": STRESS_RANKER_FEATURES, "stress_pairwise_ablation": STRESS_FEATURES},
        "count": count,
        "stress": stress,
        "isotonic": {"count": count_points, "stress": stress_points},
        "threshold_policy": "independent_three_state_precision_first",
        "training_support": {
            "train": len(train_rows),
            "calibration": len(calibration_rows),
            "train_human": sum(row.get("split") == "train" for row in train_rows),
            "train_augmentation": sum(row.get("split") == "train_augmentation" for row in train_rows),
            "train_count_labels": len(count_train_y),
            "calibration_count_labels": len(count_calibration_y),
            "train_stress_labels": len(stress_train_y),
            "calibration_stress_labels": len(stress_calibration_y),
        },
        "ablations": {
            "prior_only": {
                "evaluated": True,
                "probability": round(prior_probability, 8),
                "calibration_stress_brier": round(prior_brier, 8),
            },
            "alignment_only": {
                "evaluated": True,
                "feature_indices": alignment_indices,
                "model": alignment_head,
                "isotonic": alignment_points,
                "calibration_stress_brier": round(alignment_brier, 8),
            },
            "full_acoustic": {
                "evaluated": True,
                "calibration_stress_brier": round(full_brier, 8),
                "binary_ablation_model": stress_binary,
            },
            "material_outperformance_margin": 0.01,
            "full_beats_both": full_brier + 0.01 < min(prior_brier, alignment_brier),
        },
        "dataset_hash": dataset_hash,
    }
    artifact["artifact_sha256"] = artifact_sha256(artifact)
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--augmentation", type=Path, action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--count-only",
        action="store_true",
        help="Fit only the syllable-count head and ship a disabled stress head.",
    )
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise SystemExit("input must be a JSON array or an object containing records")
    for augmentation_path in args.augmentation:
        augmentation_payload = json.loads(augmentation_path.read_text(encoding="utf-8"))
        augmentation_rows = augmentation_payload.get("records") if isinstance(augmentation_payload, dict) else augmentation_payload
        if not isinstance(augmentation_rows, list) or any(row.get("split") != "train_augmentation" for row in augmentation_rows):
            raise SystemExit(f"augmentation input must contain only train_augmentation rows: {augmentation_path}")
        rows.extend(augmentation_rows)
    artifact = train(rows, count_only=args.count_only)
    if not args.dry_run:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "written": not args.dry_run,
        "rows": len(rows),
        "dry_run": args.dry_run,
        "release_profile": artifact.get("release_profile", "full"),
        "stress_mode": artifact["stress"].get("mode"),
        "stress_ranker_training_rows": artifact["stress"].get("training_positive_rows"),
        "stress_ranker_calibration_rows": artifact["stress"].get("calibration_positive_rows"),
        "count_thresholds": artifact["count"].get("thresholds"),
        "artifact_sha256": artifact["artifact_sha256"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
