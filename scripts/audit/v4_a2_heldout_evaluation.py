#!/usr/bin/env python3
"""Preregistered paired evaluation runner for syllable segmentation (V4-A2-EVAL-01).

Compares V2 (Praat), V3 (CTC raw), and V4 (Maximal Onset / Phonological Alignment)
against manual ground truth syllable boundaries.
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def align_and_compute_boundary_errors(
    predicted_times: List[float], manual_times: List[float]
) -> List[float]:
    """Compute absolute boundary timestamp error in milliseconds.

    Aligns internal boundaries sequentially.
    """
    if not predicted_times or not manual_times:
        return []

    n = min(len(predicted_times), len(manual_times))
    errors_ms = []
    for i in range(n):
        p = predicted_times[i]
        m = manual_times[i]
        if p is not None and m is not None:
            errors_ms.append(round(abs(p - m) * 1000.0, 3))

    return errors_ms


def compute_sample_metrics(errors_ms: List[float]) -> Dict[str, Any]:
    """Compute sample-level metrics from boundary error list in ms."""
    if not errors_ms:
        return {
            "mae_ms": None,
            "median_ms": None,
            "max_ms": None,
            "within_30ms_count": 0,
            "within_80ms_count": 0,
            "boundary_count": 0,
        }

    sorted_err = sorted(errors_ms)
    n = len(sorted_err)
    median = (
        sorted_err[n // 2]
        if n % 2 != 0
        else (sorted_err[n // 2 - 1] + sorted_err[n // 2]) / 2.0
    )

    return {
        "mae_ms": round(sum(errors_ms) / n, 2),
        "median_ms": round(median, 2),
        "max_ms": round(max(errors_ms), 2),
        "within_30ms_count": sum(1 for e in errors_ms if e <= 30.0),
        "within_80ms_count": sum(1 for e in errors_ms if e <= 80.0),
        "boundary_count": n,
    }


def compute_aggregate_metrics(sample_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute aggregate statistics across a set of sample error rows."""
    all_errors: List[float] = []
    valid_samples = 0
    total_samples = len(sample_rows)

    for row in sample_rows:
        errs = row.get("errors", [])
        if errs:
            valid_samples += 1
            all_errors.extend(errs)

    if not all_errors:
        return {
            "mae_ms": None,
            "median_ms": None,
            "p90_ms": None,
            "tolerance_30ms_pct": 0.0,
            "tolerance_80ms_pct": 0.0,
            "total_boundaries": 0,
            "valid_samples": 0,
            "total_samples": total_samples,
            "rateability_pct": 0.0,
        }

    sorted_err = sorted(all_errors)
    n_err = len(sorted_err)
    median = (
        sorted_err[n_err // 2]
        if n_err % 2 != 0
        else (sorted_err[n_err // 2 - 1] + sorted_err[n_err // 2]) / 2.0
    )
    p90_idx = min(int(math.ceil(0.90 * n_err)) - 1, n_err - 1)
    p90 = sorted_err[max(0, p90_idx)]

    count_30 = sum(1 for e in all_errors if e <= 30.0)
    count_80 = sum(1 for e in all_errors if e <= 80.0)

    return {
        "mae_ms": round(sum(all_errors) / n_err, 2),
        "median_ms": round(median, 2),
        "p90_ms": round(p90, 2),
        "tolerance_30ms_pct": round((count_30 / n_err) * 100.0, 2),
        "tolerance_80ms_pct": round((count_80 / n_err) * 100.0, 2),
        "total_boundaries": n_err,
        "valid_samples": valid_samples,
        "total_samples": total_samples,
        "rateability_pct": round((valid_samples / total_samples) * 100.0, 2) if total_samples > 0 else 0.0,
    }


def paired_bootstrap_ci(
    diffs: List[float],
    n_bootstraps: int = 1000,
    ci: float = 0.95,
    seed: int = 42,
) -> Tuple[float, float]:
    """Compute non-parametric bootstrap confidence interval for paired differences."""
    if not diffs:
        return (0.0, 0.0)

    rng = random.Random(seed)
    n = len(diffs)
    boot_means = []

    for _ in range(n_bootstraps):
        sample = [rng.choice(diffs) for _ in range(n)]
        boot_means.append(sum(sample) / n)

    boot_means.sort()
    alpha = (1.0 - ci) / 2.0
    low_idx = int(alpha * n_bootstraps)
    high_idx = int((1.0 - alpha) * n_bootstraps)

    return (round(boot_means[low_idx], 2), round(boot_means[high_idx], 2))


def wilcoxon_signed_rank(x: List[float], y: List[float]) -> Tuple[float, float]:
    """Calculate Wilcoxon signed-rank test statistic and asymptotic p-value."""
    if len(x) != len(y) or len(x) == 0:
        return (0.0, 1.0)

    diffs = [a - b for a, b in zip(x, y)]
    non_zero = [(abs(d), d) for d in diffs if abs(d) > 1e-9]
    n = len(non_zero)
    if n < 3:
        return (0.0, 1.0)

    non_zero.sort(key=lambda item: item[0])
    ranks = []
    i = 0
    while i < n:
        j = i
        while j < n and abs(non_zero[j][0] - non_zero[i][0]) < 1e-9:
            j += 1
        avg_rank = (i + 1 + j) / 2.0
        for _ in range(i, j):
            ranks.append(avg_rank)
        i = j

    w_pos = sum(r for (mag, d), r in zip(non_zero, ranks) if d > 0)
    w_neg = sum(r for (mag, d), r in zip(non_zero, ranks) if d < 0)
    w_stat = min(w_pos, w_neg)

    # Normal approximation for large samples (n >= 5)
    mean_w = n * (n + 1) / 4.0
    var_w = n * (n + 1) * (2 * n + 1) / 24.0
    z = (w_stat - mean_w) / math.sqrt(var_w) if var_w > 0 else 0.0

    # 2-tailed standard normal CDF approximation
    def norm_cdf(z_val):
        return 0.5 * (1.0 + math.erf(z_val / math.sqrt(2.0)))

    p_value = 2.0 * norm_cdf(-abs(z))
    return (round(w_stat, 2), round(p_value, 4))


def evaluate_dataset(
    samples: List[Dict[str, Any]],
    predictions: Dict[str, Dict[str, List[float]]],
    include_holdout: bool = False,
) -> Dict[str, Any]:
    """Run full paired evaluation across V2, V3, and V4."""
    seen_ids = set()
    for s in samples:
        tid = s.get("taskId")
        if not tid or tid in seen_ids:
            raise ValueError(f"Duplicate or invalid sample ID: {tid}")
        seen_ids.add(tid)

    filtered_samples = [
        s for s in samples
        if include_holdout or s.get("split") == "development"
    ]

    version_names = ["v2", "v3", "v4"]
    version_rows: Dict[str, List[Dict[str, Any]]] = {v: [] for v in version_names}
    sample_evals: List[Dict[str, Any]] = []

    for s in filtered_samples:
        tid = s["taskId"]
        target_word = s.get("targetWord", "")
        syllables = s.get("targetSyllableCount", 2)
        split = s.get("split", "development")
        manual_boundaries = s.get("manual_boundaries", s.get("manualBoundaryTimesMs", []))

        # In case manual boundaries are given in ms, convert to sec if > 10.0
        manual_sec = [
            b / 1000.0 if b > 20.0 else b
            for b in manual_boundaries
        ]

        pred_map = predictions.get(tid, {})
        row_eval: Dict[str, Any] = {
            "taskId": tid,
            "targetWord": target_word,
            "syllableCount": syllables,
            "split": split,
            "manualBoundariesSec": manual_sec,
            "versions": {},
        }

        for v in version_names:
            v_preds = pred_map.get(v, [])
            v_sec = [
                p / 1000.0 if p > 20.0 else p
                for p in v_preds
            ]
            errs = align_and_compute_boundary_errors(v_sec, manual_sec)
            metrics = compute_sample_metrics(errs)

            row_eval["versions"][v] = {
                "predictedSec": v_sec,
                "errorsMs": errs,
                "maeMs": metrics["mae_ms"],
                "within80ms": metrics["within_80ms_count"] == metrics["boundary_count"] if metrics["boundary_count"] > 0 else False,
            }

            if errs:
                version_rows[v].append({
                    "taskId": tid,
                    "errors": errs,
                    "syllable_count": syllables,
                    "split": split,
                    "mae_ms": metrics["mae_ms"],
                })

        sample_evals.append(row_eval)

    # Compute aggregate metrics per version
    version_aggregates: Dict[str, Any] = {}
    for v in version_names:
        agg = compute_aggregate_metrics(version_rows[v])
        agg["valid_count"] = len(version_rows[v])
        version_aggregates[v] = agg

    # Paired comparisons: V4 vs V2, V4 vs V3
    paired_comparisons: Dict[str, Any] = {}
    for base in ["v2", "v3"]:
        common_ids = [
            s["taskId"] for s in sample_evals
            if s["versions"]["v4"]["maeMs"] is not None and s["versions"][base]["maeMs"] is not None
        ]
        if common_ids:
            v4_maes = [s["versions"]["v4"]["maeMs"] for s in sample_evals if s["taskId"] in common_ids]
            base_maes = [s["versions"][base]["maeMs"] for s in sample_evals if s["taskId"] in common_ids]
            diffs = [v4 - b for v4, b in zip(v4_maes, base_maes)]

            ci_low, ci_high = paired_bootstrap_ci(diffs)
            stat, p_val = wilcoxon_signed_rank(v4_maes, base_maes)

            paired_comparisons[f"v4_vs_{base}"] = {
                "n_pairs": len(common_ids),
                "mean_diff_ms": round(sum(diffs) / len(diffs), 2),
                "bootstrap_ci_95": [ci_low, ci_high],
                "wilcoxon_stat": stat,
                "p_value": p_val,
                "v4_superior": ci_high < 0.0 and p_val < 0.05,
            }

    # Breakdown by syllable count for V4
    syllable_breakdown: Dict[int, Any] = {}
    for cnt in [2, 3, 4, 5]:
        rows_cnt = [r for r in version_rows["v4"] if r.get("syllable_count") == cnt]
        syllable_breakdown[cnt] = compute_aggregate_metrics(rows_cnt)

    return {
        "timestampUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "totalSamples": len(filtered_samples),
        "includeHoldout": include_holdout,
        "versions": version_aggregates,
        "pairedComparisons": paired_comparisons,
        "v4SyllableBreakdown": syllable_breakdown,
        "samples": sample_evals,
    }


def main():
    parser = argparse.ArgumentParser(description="Run V4 held-out evaluation.")
    parser.add_argument("--samples", required=True, help="Path to blind export JSON.")
    parser.add_argument("--predictions", required=True, help="Path to predictions JSON.")
    parser.add_argument("--include-holdout", action="store_true", help="Include holdout samples.")
    parser.add_argument("--out", default="test-results/v4-a2-evaluation-summary.json")
    args = parser.parse_args()

    with open(args.samples, "r", encoding="utf-8") as f:
        samples_data = json.load(f)
    samples = samples_data.get("entries", samples_data)

    with open(args.predictions, "r", encoding="utf-8") as f:
        predictions = json.load(f)

    report = evaluate_dataset(samples, predictions, include_holdout=args.include_holdout)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"Evaluation complete. Report written to {args.out}")


if __name__ == "__main__":
    main()
