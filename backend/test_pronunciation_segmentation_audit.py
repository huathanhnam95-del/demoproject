#!/usr/bin/env python3
"""Unit tests for the pronunciation segmentation v3 audit script.

Validates the audit metrics, alignment logic, gate evaluation, and report writing.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Import the module under test
import sys

import importlib.util

# Resolve path to scripts/audit/pronunciation-segmentation-audit.py
audit_script_path = Path(__file__).resolve().parent.parent / "scripts" / "audit" / "pronunciation-segmentation-audit.py"

spec = importlib.util.spec_from_file_location("pronunciation_segmentation_audit", str(audit_script_path))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class TestPronunciationSegmentationAudit(unittest.TestCase):
    """Tests for the v3 audit verification and promotion gates."""

    def test_align_and_compute_mae_empty(self):
        """align_and_compute_mae should return None if either list is empty."""
        self.assertIsNone(audit.align_and_compute_mae([], []))
        self.assertIsNone(audit.align_and_compute_mae([{"start_time": 0.0}], []))
        self.assertIsNone(audit.align_and_compute_mae([], [{"start_time": 0.0}]))

    def test_align_and_compute_mae_correct(self):
        """align_and_compute_mae should compute correct boundary MAE."""
        observed = [
            {"start_time": 0.1, "end_time": 0.5},
            {"start_time": 0.6, "end_time": 1.0},
        ]
        verified = [
            {"start_time": 0.12, "end_time": 0.48},
            {"start_time": 0.59, "end_time": 1.05},
        ]
        # Differences:
        # Start 1: |0.1 - 0.12| = 0.02
        # End 1: |0.5 - 0.48| = 0.02
        # Start 2: |0.6 - 0.59| = 0.01
        # End 2: |1.0 - 1.05| = 0.05
        # Total absolute difference: 0.02 + 0.02 + 0.01 + 0.05 = 0.10
        # Average (4 boundaries): 0.10 / 4 = 0.025 (25 ms)
        mae = audit.align_and_compute_mae(observed, verified)
        self.assertIsNotNone(mae)
        self.assertAlmostEqual(mae, 0.025, places=5)

    def test_align_and_compute_mae_mismatched_length(self):
        """align_and_compute_mae aligns up to the shorter list length."""
        observed = [
            {"start_time": 0.1, "end_time": 0.5},
        ]
        verified = [
            {"start_time": 0.12, "end_time": 0.48},
            {"start_time": 0.6, "end_time": 1.0},
        ]
        mae = audit.align_and_compute_mae(observed, verified)
        self.assertIsNotNone(mae)
        self.assertAlmostEqual(mae, 0.02, places=5)

    def test_calculate_precision_recall(self):
        """calculate_precision_recall should return correct values and handle zeroes."""
        # 1. Standard precision/recall
        prec, rec = audit.calculate_precision_recall(tp=8, fp=2, fn=1)
        self.assertAlmostEqual(prec, 0.8)
        self.assertAlmostEqual(rec, 8.0 / 9.0)

        # 2. Div by zero handling (should return 1.0 by definition when no predicted/actual)
        prec, rec = audit.calculate_precision_recall(tp=0, fp=0, fn=0)
        self.assertEqual(prec, 1.0)
        self.assertEqual(rec, 1.0)

    def test_evaluate_promotion_gates_passing(self):
        """evaluate_promotion_gates should pass when all metrics meet the criteria."""
        # Setup results that meet all gates
        results = []

        # Add 6 mandatory clean words, all correct
        for word in audit.MANDATORY_WORDS:
            results.append({
                "sampleId": f"sample-{word}",
                "targetWord": word,
                "expectedObservedCount": 3,
                "syllable_count": 3,
                "expected_syllables_target": 3,
                "category": "clean",
                "is_rateable": True,
                "total_duration": 1.2,
                "has_pitch": True,
                "has_intensity": True,
                "boundary_mae": 0.015,
            })

        # Add some accented words, correct
        results.append({
            "sampleId": "sample-accented",
            "targetWord": "banana",
            "expectedObservedCount": 3,
            "syllable_count": 3,
            "expected_syllables_target": 3,
            "category": "accented",
            "is_rateable": True,
            "total_duration": 1.2,
            "has_pitch": True,
            "has_intensity": True,
            "boundary_mae": 0.020,
        })

        model_manifest = {
            "benchmark": {
                "peakRssGiB": 2.8,
            }
        }
        latencies = [0.5, 0.6, 0.7, 0.8]  # all warm, well under 2.0s

        gates, all_pass = audit.evaluate_promotion_gates(results, model_manifest, latencies)
        self.assertTrue(all_pass)
        self.assertTrue(gates["mandatory_clean_words"]["passed"])
        self.assertTrue(gates["overall_clean_accuracy"]["passed"])
        self.assertTrue(gates["accented_accuracy"]["passed"])
        self.assertTrue(gates["boundary_mae"]["passed"])
        self.assertTrue(gates["duration_availability"]["passed"])
        self.assertTrue(gates["warm_p95_latency"]["passed"])
        self.assertTrue(gates["peak_rss"]["passed"])
        self.assertTrue(gates["graph_availability"]["passed"])

    def test_evaluate_promotion_gates_failing_mandatory(self):
        """evaluate_promotion_gates should fail if a mandatory word is incorrect."""
        results = []
        # Missing one mandatory word to cause failure
        for i, word in enumerate(audit.MANDATORY_WORDS):
            results.append({
                "sampleId": f"sample-{word}",
                "targetWord": word,
                "expectedObservedCount": 3,
                "syllable_count": 2 if i == 0 else 3,  # one wrong
                "expected_syllables_target": 3,
                "category": "clean",
                "is_rateable": True,
                "total_duration": 1.2,
                "has_pitch": True,
                "has_intensity": True,
                "boundary_mae": 0.015,
            })

        model_manifest = {"benchmark": {"peakRssGiB": 2.8}}
        gates, all_pass = audit.evaluate_promotion_gates(results, model_manifest, [0.5])
        self.assertFalse(all_pass)
        self.assertFalse(gates["mandatory_clean_words"]["passed"])

    def test_evaluate_promotion_gates_failing_rss(self):
        """evaluate_promotion_gates should fail if peak RSS is too high."""
        results = []
        for word in audit.MANDATORY_WORDS:
            results.append({
                "sampleId": f"sample-{word}",
                "targetWord": word,
                "expectedObservedCount": 3,
                "syllable_count": 3,
                "expected_syllables_target": 3,
                "category": "clean",
                "is_rateable": True,
                "total_duration": 1.2,
                "has_pitch": True,
                "has_intensity": True,
                "boundary_mae": 0.015,
            })

        model_manifest = {"benchmark": {"peakRssGiB": 3.8}}  # Limit is 3.5 GiB
        gates, all_pass = audit.evaluate_promotion_gates(results, model_manifest, [0.5])
        self.assertFalse(all_pass)
        self.assertFalse(gates["peak_rss"]["passed"])

    def test_write_reports(self):
        """write_reports should correctly create files in the output directory."""
        gates = {
            "test_gate": {
                "description": "Test Gate Description",
                "expected": ">= 90%",
                "actual": "95%",
                "passed": True,
            }
        }
        results = [{
            "sampleId": "sample-1",
            "targetWord": "test",
            "expectedObservedCount": 1,
            "syllable_count": 1,
            "is_rateable": True,
            "boundary_mae": 0.012,
        }]
        health_info = {"status": "ok", "pronunciationV3Mode": "shadow"}

        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = Path(tmpdir)
            json_file, md_file = audit.write_reports(
                out_path, gates, True, results, health_info
            )

            self.assertTrue(json_file.exists())
            self.assertTrue(md_file.exists())

            # Verify JSON content
            with open(json_file, "r", encoding="utf-8") as f:
                json_data = json.load(f)
                self.assertEqual(json_data["health"]["pronunciationV3Mode"], "shadow")
                self.assertTrue(json_data["summary"]["all_gates_passed"])
                self.assertEqual(len(json_data["results"]), 1)

            # Verify Markdown content
            with open(md_file, "r", encoding="utf-8") as f:
                md_content = f.read()
                self.assertIn("# Pronunciation V3 Segmentation Audit Report", md_content)
                self.assertIn("Test Gate Description", md_content)
                self.assertIn("sample-1", md_content)


if __name__ == "__main__":
    unittest.main()
