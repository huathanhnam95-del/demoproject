"""Unit tests for V4-A2 held-out segmentation evaluation and paired metrics runner."""

import math
import unittest
from typing import Any, Dict, List

# Imports from evaluation runner module
try:
    from scripts.audit.v4_a2_heldout_evaluation import (
        align_and_compute_boundary_errors,
        compute_aggregate_metrics,
        compute_sample_metrics,
        paired_bootstrap_ci,
        wilcoxon_signed_rank,
        evaluate_dataset,
    )
except ImportError:
    # Will be defined in implementation
    align_and_compute_boundary_errors = None
    compute_aggregate_metrics = None
    compute_sample_metrics = None
    paired_bootstrap_ci = None
    wilcoxon_signed_rank = None
    evaluate_dataset = None


class TestHeldoutEvaluationMetrics(unittest.TestCase):
    """Test boundary alignment and error metrics calculation."""

    def setUp(self):
        if align_and_compute_boundary_errors is None:
            self.skipTest("v4_a2_heldout_evaluation not yet imported")

    def test_align_and_compute_boundary_errors_exact_match(self):
        # Ground truth: 2 internal boundaries (3 syllables) at t=0.45s, 0.89s
        manual_times = [0.45, 0.89]
        # Predicted: exact match
        predicted_times = [0.45, 0.89]
        errors = align_and_compute_boundary_errors(predicted_times, manual_times)
        self.assertEqual(len(errors), 2)
        self.assertAlmostEqual(errors[0], 0.0, places=2)
        self.assertAlmostEqual(errors[1], 0.0, places=2)

    def test_align_and_compute_boundary_errors_in_milliseconds(self):
        # Ground truth: 0.500s (500ms)
        manual_times = [0.500]
        # Predicted: 0.525s (525ms -> delta = 25ms)
        predicted_times = [0.525]
        errors = align_and_compute_boundary_errors(predicted_times, manual_times)
        self.assertEqual(len(errors), 1)
        self.assertAlmostEqual(errors[0], 25.0, places=2)

    def test_compute_sample_metrics(self):
        errors = [10.0, 20.0, 60.0]
        metrics = compute_sample_metrics(errors)
        self.assertAlmostEqual(metrics["mae_ms"], 30.0, places=2)
        self.assertAlmostEqual(metrics["median_ms"], 20.0, places=2)
        self.assertAlmostEqual(metrics["max_ms"], 60.0, places=2)
        self.assertEqual(metrics["within_30ms_count"], 2)
        self.assertEqual(metrics["within_80ms_count"], 3)
        self.assertEqual(metrics["boundary_count"], 3)

    def test_compute_aggregate_metrics(self):
        sample_rows = [
            {"errors": [10.0, 20.0], "syllable_count": 3, "split": "development"},
            {"errors": [40.0, 80.0], "syllable_count": 3, "split": "development"},
            {"errors": [100.0], "syllable_count": 2, "split": "holdout"},
        ]
        agg = compute_aggregate_metrics(sample_rows)
        # All errors = [10, 20, 40, 80, 100] -> mean = 50.0
        self.assertAlmostEqual(agg["mae_ms"], 50.0, places=2)
        self.assertAlmostEqual(agg["median_ms"], 40.0, places=2)
        self.assertEqual(agg["total_boundaries"], 5)
        self.assertAlmostEqual(agg["tolerance_30ms_pct"], 40.0, places=1) # 2/5 = 40%
        self.assertAlmostEqual(agg["tolerance_80ms_pct"], 80.0, places=1) # 4/5 = 80%

    def test_paired_bootstrap_ci(self):
        # V4 errors consistently smaller than V2 errors
        v2_errors = [60.0, 70.0, 80.0, 90.0, 100.0, 75.0, 85.0, 95.0]
        v4_errors = [20.0, 25.0, 30.0, 35.0, 40.0, 28.0, 32.0, 38.0]
        diffs = [v4 - v2 for v4, v2 in zip(v4_errors, v2_errors)]
        ci_lower, ci_upper = paired_bootstrap_ci(diffs, n_bootstraps=200, seed=42)
        # Difference (V4 - V2) should be strongly negative (significant improvement)
        self.assertTrue(ci_upper < 0.0)
        self.assertTrue(ci_lower < ci_upper)

    def test_wilcoxon_signed_rank(self):
        x = [10.0, 20.0, 30.0, 40.0, 50.0]
        y = [20.0, 35.0, 45.0, 55.0, 70.0]
        stat, p_val = wilcoxon_signed_rank(x, y)
        self.assertTrue(p_val < 0.05)


class TestEvaluateDatasetContract(unittest.TestCase):
    """Test full dataset evaluation pipeline."""

    def setUp(self):
        if evaluate_dataset is None:
            self.skipTest("evaluate_dataset not yet implemented")

    def test_duplicate_sample_id_fails_closed(self):
        samples = [
            {"taskId": "task-01", "targetWord": "camera", "manual_boundaries": [0.3, 0.6]},
            {"taskId": "task-01", "targetWord": "camera", "manual_boundaries": [0.3, 0.6]},
        ]
        with self.assertRaises(ValueError):
            evaluate_dataset(samples, {})

    def test_missing_version_marks_version_unrateable(self):
        samples = [
            {
                "taskId": "task-01",
                "targetWord": "camera",
                "targetSyllableCount": 3,
                "split": "development",
                "manual_boundaries": [0.35, 0.70],
            }
        ]
        predictions = {
            "task-01": {
                "v2": [0.32, 0.72],
                # v3 missing
                "v4": [0.35, 0.70],
            }
        }
        report = evaluate_dataset(samples, predictions)
        self.assertIn("v2", report["versions"])
        self.assertIn("v4", report["versions"])
        self.assertAlmostEqual(report["versions"]["v4"]["mae_ms"], 0.0, places=1)
        self.assertEqual(report["versions"]["v3"]["valid_count"], 0)


if __name__ == "__main__":
    unittest.main()
